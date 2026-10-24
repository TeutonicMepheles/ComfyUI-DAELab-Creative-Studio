import {STATE_KEY} from '../../../canvas/creative_canvas_model.mjs';

function withoutLayout(snapshot){
    return JSON.stringify({...snapshot,nodes:snapshot.nodes.map(node=>({...node,properties:{...node.properties,daelabLayoutRevision:undefined}})),extra:{...snapshot.extra,[STATE_KEY]:{...snapshot.extra[STATE_KEY],cards:null}}});
}

// Keep the host's undo queues and notifications; only skip its graph reload for layout-only restores.
export function installLayoutHistory(app){
    const load=app.loadGraphData;
    app.loadGraphData=async function(...args){
        const [snapshot,reset=true,restoreView=true,workflow=null]=args;
        const t=app.extensionManager?.workflow?.activeWorkflow?.changeTracker;
        // Initial loading may precede graph construction. Only inspect a live graph
        // for the host's explicit history-restore call, never an ordinary open.
        if(app.isGraphReady===false||reset!==false||restoreView!==false||!t?._restoringState||t.changeCount!==0||workflow!==t.workflow)return load.apply(this,args);
        const graph=app.graph,view=app.daelabCreativeCanvas;
        const current=graph?.extra?.[STATE_KEY],next=snapshot?.extra?.[STATE_KEY];
        if(reset===false&&restoreView===false&&t?._restoringState&&t.changeCount===0&&workflow===t.workflow&&graph===app.rootGraph&&view?.active&&current?.active&&next?.active){
            const live=graph.serialize();
            if(withoutLayout(live)===withoutLayout(snapshot)&&JSON.stringify(Object.keys(current.cards).sort())===JSON.stringify(Object.keys(next.cards).sort())){
                for(const [id,layout] of Object.entries(next.cards)){
                    const target=current.cards[id];
                    for(const key of Object.keys(target))if(!(key in layout))delete target[key];
                    Object.assign(target,JSON.parse(JSON.stringify(layout)));
                }
                for(const saved of snapshot.nodes){
                    const node=graph.getNodeById(saved.id),revision=saved.properties?.daelabLayoutRevision;
                    if(revision===undefined)delete node.properties.daelabLayoutRevision;else node.properties.daelabLayoutRevision=revision;
                }
                view.sync();graph.setDirtyCanvas?.(true,true);return;
            }
        }
        return load.apply(this,args);
    };
}

// Compatibility boundary for DOM canvas edits and the host workflow undo stack.
export function canvasHistory(app,{diagnose=diagnostic=>{
    console.error('[Creative Studio]',diagnostic.code,diagnostic.capability);
    app.extensionManager?.toast?.add?.({severity:'error',summary:'创作画布宿主能力缺失',detail:diagnostic.message,life:8000});
}}={}){
    const tracker=()=>app.extensionManager?.workflow?.activeWorkflow?.changeTracker;
    const transactions=[];
    function reject(capability){
        const message=`宿主缺少 ${capability} 能力，已拒绝此操作以保护工作流保存和撤销。`;
        diagnose({code:'canvas-host-capability',capability,message});throw new Error(message);
    }
    function editable(){
        const t=tracker();
        if(app.isGraphReady===false)reject('graph-initialization');
        if(typeof app.graph?.serialize!=='function'||typeof app.rootGraph?.serialize!=='function')reject('serialization');
        for(const name of ['captureCanvasState','beforeChange','afterChange'])if(typeof t?.[name]!=='function')reject(`history.${name}`);
        if(typeof t.squashState?.flush!=='function')reject('history.flush');
        return t;
    }
    // Flush the host debounce before a drag; otherwise it can replace the
    // pre-drag undo state with an intermediate position while changeCount > 0.
    return {
        assertEditable(){editable();},
        begin(){const t=editable();t.captureCanvasState();t.squashState.flush();t.beforeChange();transactions.push(t);},
        // A mode/workflow switch must close the tracker that began the edit.
        end(){transactions.pop()?.afterChange();},
        async undo(){const t=editable();if(typeof t.undo!=='function')reject('history.undo');t.squashState.flush();await t.undo();},
        async redo(){const t=editable();if(typeof t.redo!=='function')reject('history.redo');t.squashState.flush();await t.redo();},
        prepareNativeShortcut(event){
            const key=String(event.key).toUpperCase();
            if(!(event.ctrlKey||event.metaKey)||event.altKey||event.repeat||event.isComposing||event.keyCode===229||!(key==='Z'||(key==='Y'&&!event.shiftKey)))return false;
            const t=editable();if(typeof t.undoRedo!=='function')reject('history.keyboard');
            // The host's window capture listener has already queued undoRedo in
            // rAF. Calling undo/redo here would execute a second history step;
            // stopping propagation at the Canvas root cannot cancel that queue.
            t.squashState.flush();event.preventDefault();return true;
        },
        // Fold derived changes into the current state without another undo step or clearing redo.
        amend(change){
            const t=editable();if(typeof t.updateModified!=='function')reject('history.updateModified');
            t.squashState.flush();t.captureCanvasState();
            const nested=t.changeCount>0,previous=t.activeState;
            t.beforeChange();
            try{
                const result=change();
                if(!nested){t.activeState=JSON.parse(JSON.stringify(app.rootGraph.serialize()));t.updateModified(previous);}
                return result;
            }finally{t.afterChange();}
        },
        updateViewport(viewport){
            const t=tracker();if(!t)return;
            // The host compares custom graph.extra data, including our viewport.
            // Keep only view coordinates current across its snapshots; edits stay intact.
            for(const snapshot of new Set([t.initialState,t.activeState,...(t.undoQueue||[]),...(t.redoQueue||[])])){
                const canvas=snapshot?.extra?.[STATE_KEY];if(canvas)canvas.viewport={...viewport};
            }
        },
    };
}
