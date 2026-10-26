import {app} from '/scripts/app.js';
import './video_generate.js';
import {installBusinessHost,BusinessCapabilityUnavailable} from '../../../contracts/business.js';
import {bindBusinessHttp} from './business_http.js';
import {canvasHistory} from '../canvas/creative_history.mjs';
import {createCanvasHostPort} from '../canvas/canvas_host.js';
import {installBusinessDocuments,invalidateBusinessDocuments,loadedBusinessWorkflow} from './business_document_host.js';
app.registerExtension({
    name:'DAELab.Business.Host',
    setup(){
        const diagnose=diagnostic=>app.extensionManager?.toast?.add?.({severity:'error',summary:'创作工作室',detail:diagnostic.message,life:8000});
        const history=canvasHistory(app,{diagnose}),canvas=createCanvasHostPort(app,globalThis.LiteGraph,history,diagnose);
        installBusinessDocuments(app,history);
        const fetchApi=(url,options)=>{
            if(!app.api?.fetchApi)throw new BusinessCapabilityUnavailable('host-http');
            return app.api.fetchApi(url,options);
        };
        installBusinessHost({history,nodes:graph=>canvas.nodes(graph),createNode:type=>canvas.createNode(type),addNode:(graph,node)=>canvas.addNode(graph,node),
            focusNode(node){app.canvas?.selectNode?.(node);app.canvas?.centerOnNode?.(node);},
            isSelected:node=>app.canvas?.selected_nodes?.[node.id]===node,
            fetchNative:(url,options)=>url.startsWith('data:')?fetch(url,options):fetchApi(url,options),
        });
        bindBusinessHttp(fetchApi);
        // Provider availability is reported by the new backend; no legacy fallback.
    },
    beforeConfigureGraph(){invalidateBusinessDocuments();},
    afterLoadGraph(){loadedBusinessWorkflow();},
});
