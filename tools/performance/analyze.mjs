import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assessReport} from '../../tests/host_fixture/web/performance.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export function analyze(raw){
    if(raw?.schemaVersion!==1||!Array.isArray(raw.reports)||!raw.reports.length)throw Error('Raw report bundle required');
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/performance/manifest.json'),'utf8'));
    const fixtureHashes=new Set(manifest.workflows.map(w=>w.sha256));
    fixtureHashes.add(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'tests/fixtures/asset-library/search-2000.json'))).digest('hex'));
    return {schemaVersion:1,kind:'performance-evidence-review-not-acceptance',reports:raw.reports.map(report=>{
        if(report.schemaVersion!==1||report.kind!=='passive-performance-observation'||!Array.isArray(report.runs))throw Error('Invalid observation report');
        if(!/^PERF-0[1-8]$/.test(report.scenario))throw Error('Unknown performance scenario');
        for(const run of report.runs)for(const key of ['frames','inputs','eventTimings','longTasks','census','visibility'])if(!Array.isArray(run[key]))throw Error(`Missing raw ${key}`);
        const assessment=assessReport(report);
        if(!fixtureHashes.has(report.fixture?.sha256)){assessment.status='insufficient_evidence';assessment.reasons.push('fixture_not_in_fixed_catalog');}
        const maxVisible=report.runs.flatMap(r=>r.census).reduce((n,c)=>Math.max(n,c.visibleVideos||0),0),maxPlaying=report.runs.flatMap(r=>r.census).reduce((n,c)=>Math.max(n,c.playingVideos||0),0);
        const spec=manifest.workflows.find(w=>w.sha256===report.fixture?.sha256);
        if(report.mediaVariant==='video'&&maxPlaying<1||report.mediaVariant==='no-video'&&maxPlaying>0||spec&&maxVisible>spec.videos){assessment.status='insufficient_evidence';assessment.reasons.push('media_variant_not_observed_as_declared');}
        return {scenario:report.scenario,implementation:report.implementation,fixture:report.fixture,buildFingerprint:report.buildFingerprint,environment:report.environment,maxVisibleVideos:maxVisible,maxPlayingVideos:maxPlaying,...assessment};
    })};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    const [source,output]=process.argv.slice(2);if(!source||!output)throw Error('Usage: node tools/performance/analyze.mjs raw.json summary.json');
    if(path.resolve(source)===path.resolve(output)||fs.existsSync(output))throw Error('Choose a new summary path; never overwrite raw evidence or an earlier summary');
    const bytes=fs.readFileSync(source);const result={rawSha256:crypto.createHash('sha256').update(bytes).digest('hex'),...analyze(JSON.parse(bytes))};
    fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({reports:result.reports.length,productAcceptance:false,statuses:result.reports.map(r=>r.status)}));
}
