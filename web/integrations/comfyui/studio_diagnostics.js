import {app} from '/scripts/app.js';
import {checkStudioHealth} from './health_client.js';
import {installAssetServices} from './asset_services.js';
import {installCompatReadonly} from './compat_readonly.js';

// Register the legacy readers before ComfyUI constructs native/virtual node types.
installCompatReadonly(app);

app.registerExtension({
    name: 'DAELAB.CreativeStudio.Diagnostics',
    async setup() {
        const result = await checkStudioHealth();
        if (!result.available) {
            app.extensionManager?.toast?.add?.({severity:'error',summary:'Creative Studio 安装诊断',detail:result.reason,life:10000});
            console.error(result.reason);
        } else {
            installAssetServices();
        }
        globalThis[Symbol.for('DAELAB.CreativeStudio.Health.v1')] = Object.freeze(result);
    },
});
