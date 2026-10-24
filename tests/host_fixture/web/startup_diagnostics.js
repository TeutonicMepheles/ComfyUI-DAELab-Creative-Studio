// Test fixture only. Capture a stack for this exact host readiness warning;
// neither arbitrary console payloads nor workflow data are copied.
const originalError = console.error.bind(console);
console.error = (...args) => {
    originalError(...args);
    if (args[0] === 'ComfyApp graph accessed before initialization') {
        originalError('[Studio acceptance] graph readiness stack', new Error('graph readiness').stack);
    }
};
