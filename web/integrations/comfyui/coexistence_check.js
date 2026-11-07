// Fail-closed frontend coexistence self-check for contested extension names.
//
// The backend arbitration (backend/integrations/comfyui/coexistence.py) pins the
// four contested extension names to Studio. When the legacy Custom Nodes Library
// is present under coexistence it must yield these four names; a second
// registration means its yield gate did not apply and one of the two `setup()`
// callbacks would be silently skipped. This check runs during `app.setup()`,
// after every package has registered, and fails closed on any duplicate or
// missing registration.
import {app} from '/scripts/app.js';

// Mirrors backend/integrations/comfyui/coexistence.py CONTESTED_EXTENSIONS.
const CONTESTED_EXTENSION_NAMES = [
    'DAELab.DataTable',
    'DAELab.ScriptParser',
    'DAELab.LLMStylePreview',
    'DAELab.PromptOptimization.Identity.v1',
];

app.registerExtension({
    name: 'DAELab.Studio.CoexistenceCheck',
    setup() {
        if (!Array.isArray(app.extensions)) {
            console.warn('Creative Studio coexistence extension self-check skipped: app.extensions unavailable');
            return;
        }
        const names = app.extensions.map((extension) => extension && extension.name);
        const errors = [];
        for (const name of CONTESTED_EXTENSION_NAMES) {
            const count = names.filter((registered) => registered === name).length;
            if (count !== 1) {
                errors.push(`${name}: expected exactly one registration, found ${count}`);
            }
        }
        if (errors.length) {
            const message = 'Creative Studio coexistence extension self-check failed: ' + errors.join('; ');
            console.error(message);
            app.extensionManager?.toast?.add?.({
                severity: 'error',
                summary: '三包共存扩展自检失败',
                detail: message,
                life: 10000,
            });
            throw new Error(message);
        }
    },
});
