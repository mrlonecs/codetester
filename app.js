const starterCode = `import math
from datetime import datetime

def banner(title):
    print(f"\\n{'=' * 12} {title} {'=' * 12}")

banner('PyStudio demo')
print('Started at:', datetime.utcnow().isoformat(), 'UTC')
print('Squares:', [n * n for n in range(1, 6)])
print('Cos(0):', math.cos(0))

name = 'developer'
print(f'Hello, {name}! Ready to build something?')
`;

const statusText = document.getElementById('status-text');
const terminalState = document.getElementById('terminal-state');
const runButton = document.getElementById('run-btn');
const clearButton = document.getElementById('clear-btn');
const resetButton = document.getElementById('reset-btn');
const lineCount = document.getElementById('line-count');
const charCount = document.getElementById('char-count');

const terminal = new Terminal({
  convertEol: true,
  cursorBlink: true,
  fontFamily: '"Fira Code", "JetBrains Mono", monospace',
  fontSize: 14,
  theme: { background: '#020817', foreground: '#e2e8f0' },
});
const fitAddon = new FitAddon.FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(document.getElementById('terminal'));
fitAddon.fit();
terminal.writeln('PyStudio terminal ready. Python runtime loads on first run.');
window.addEventListener('resize', () => fitAddon.fit());

let editor;
let worker;
let isRunning = false;

function setStatus(message) {
  statusText.textContent = message;
}

function setTerminalState(message) {
  terminalState.textContent = message;
}

function refreshStats() {
  const value = editor.getValue();
  lineCount.textContent = `${editor.session.getLength()} lines`;
  charCount.textContent = `${value.length} chars`;
}

function appendTimestamp() {
  terminal.writeln(`\x1b[90m[${new Date().toLocaleTimeString()}]\x1b[0m`);
}

function bootstrapWorker() {
  const workerSource = `
    let pyodideReadyPromise;

    async function loadRuntime() {
      if (!pyodideReadyPromise) {
        pyodideReadyPromise = (async () => {
          self.postMessage({ type: 'status', payload: 'Loading Pyodide runtime…' });
          importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.js');
          const pyodide = await self.loadPyodide();
          self.postMessage({ type: 'status', payload: 'Python runtime ready.' });
          return pyodide;
        })();
      }
      return pyodideReadyPromise;
    }

    self.onmessage = async (event) => {
      if (event.data.type !== 'run') return;

      const pyodide = await loadRuntime();
      self.postMessage({ type: 'execution-start' });
      const out = [];
      const err = [];
      pyodide.setStdout({ batched: (text) => out.push(text) });
      pyodide.setStderr({ batched: (text) => err.push(text) });

      try {
        const wrapped = [
          'import traceback',
          '__user_code = ' + JSON.stringify(event.data.payload.code),
          'globals_dict = {"__name__": "__main__"}',
          'try:',
          '    exec(__user_code, globals_dict)',
          'except Exception:',
          '    traceback.print_exc()',
        ].join('\\n');
        await pyodide.runPythonAsync(wrapped);
      } catch (error) {
        err.push(error?.message || 'Unexpected execution error.');
      }

      self.postMessage({ type: 'stdout', payload: out.join('\\n') });
      self.postMessage({ type: 'stderr', payload: err.join('\\n') });
      self.postMessage({ type: 'execution-complete' });
    };
  `;

  worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
  worker.onmessage = ({ data }) => {
    if (data.type === 'status') setStatus(data.payload);
    if (data.type === 'execution-start') {
      isRunning = true;
      runButton.disabled = true;
      setTerminalState('Execution in progress');
    }
    if (data.type === 'stdout' && data.payload) terminal.writeln(data.payload);
    if (data.type === 'stderr' && data.payload) terminal.writeln(`\x1b[31m${data.payload}\x1b[0m`);
    if (data.type === 'execution-complete') {
      terminal.writeln('\x1b[32mProcess finished.\x1b[0m');
      isRunning = false;
      runButton.disabled = false;
      setTerminalState('Idle');
    }
  };
}

function initializeEditor() {
  editor = ace.edit('editor');
  editor.setTheme('ace/theme/monokai');
  editor.session.setMode('ace/mode/python');
  editor.setValue(starterCode, -1);
  editor.setOptions({
    autoScrollEditorIntoView: true,
    copyWithEmptySelection: true,
    enableBasicAutocompletion: true,
    enableLiveAutocompletion: true,
    enableSnippets: true,
    fontSize: '15px',
    highlightActiveLine: true,
    printMargin: false,
    showPrintMargin: false,
    tabSize: 4,
    useSoftTabs: true,
    wrap: true,
  });
  editor.commands.addCommand({
    name: 'runPython',
    bindKey: { win: 'Ctrl-Enter', mac: 'Command-Enter' },
    exec: runCode,
  });
  editor.session.on('change', refreshStats);
  refreshStats();
  setStatus('Editor ready. Python runtime loads on first run.');
}

function runCode() {
  if (isRunning || !worker || !editor) return;
  appendTimestamp();
  terminal.writeln('\x1b[34m$ python main.py\x1b[0m');
  worker.postMessage({ type: 'run', payload: { code: editor.getValue() } });
}

clearButton.addEventListener('click', () => {
  terminal.clear();
  terminal.writeln('Terminal cleared.');
});

resetButton.addEventListener('click', () => {
  editor.setValue(starterCode, -1);
  refreshStats();
});

runButton.addEventListener('click', runCode);

window.addEventListener('load', () => {
  initializeEditor();
  bootstrapWorker();
});
