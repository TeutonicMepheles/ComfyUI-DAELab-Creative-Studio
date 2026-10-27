import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {localMarkdownLinks} from './document_links.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const candidates=process.argv.slice(2);
const files=candidates.length?candidates:execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\n').filter(p=>(p.endsWith('/README.md')||p==='README.md'||/^docs\/(?:INSTALLATION|USAGE|MODELS|TROUBLESHOOTING|MODULARITY_PLAN|WRITING|DEVELOPMENT)\.md$/.test(p))&&!p.includes('/vendor/')&&!p.startsWith('tools/migration/legacy_probe/'));
const errors=[];
for(const file of new Set(files)){const full=path.resolve(root,file);if(!fs.existsSync(full)){errors.push(`${file}: missing document`);continue;}
 for(const link of localMarkdownLinks(fs.readFileSync(full,'utf8'))){const target=decodeURI(link.split(/[?#]/)[0]);if(target&&!fs.existsSync(path.resolve(path.dirname(full),target)))errors.push(`${file}: missing local link ${link}`);}
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log(`Local Markdown file links passed for ${new Set(files).size} documents (external URLs and anchors not fetched).`);
