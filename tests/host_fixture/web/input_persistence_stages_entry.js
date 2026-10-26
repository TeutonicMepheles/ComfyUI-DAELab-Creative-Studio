/** Test-only entry. Mounting shows controls; only trusted Start enables diagnosis. */
import { app } from '/scripts/app.js';
import { mountInputPersistenceStages } from './input_persistence_stages.js';

function mount(){mountInputPersistenceStages(document,window,{app});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
else mount();
