/** Test-only WEB_DIRECTORY entry: mounts visible UI, never starts observation.
 * The implementation module stays inert when imported. Host graph readiness is
 * checked only after the user presses Start; no graph getter is read here.
 */
import { app } from '/scripts/app.js';
import { api } from '/scripts/api.js';
import { mountNativePerformanceObserver } from './performance_native.js';

function mount(){mountNativePerformanceObserver(document,window,{app,api});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
else mount();
