export const SCRIPT_ROW_LIMIT = 10;
const ids = ['sp-shot_no', 'sp-scene', 'sp-reference', 'sp-notes'];
const copy = (value) => structuredClone(value);
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
const active = new Set(['waiting', 'running', 'queued', 'preparing', 'submitting', 'recovering', 'pausing']);
export const isFixedScript = (table) => table.meta?.script_parser?.field_policy === 'fixed-four';
export function emptyFixedScript() {
    return { version: 1, view: 'table', fields: [
            { id: ids[0], name: '镜号/序号', type: 'text', width: 180, hidden: false },
            { id: ids[1], name: '画面描述', type: 'json', presentation: 'prompt', width: 360, hidden: false },
            { id: ids[2], name: '画面参考', type: 'content', width: 300, hidden: false, video_reference: false },
            { id: ids[3], name: '备注', type: 'longtext', width: 180, hidden: false },
        ], records: [], meta: { material_columns: true, video_reference_version: 1, generationInput: { version: 1, promptFieldId: 'sp-scene' }, script_parser: { version: 1, field_policy: 'fixed-four', bindings: { shot_no: 'sp-shot_no', scene: 'sp-scene', notes: 'sp-notes' }, reference_fields: ['sp-reference'], documents: [] } } };
}
export function validateFixedScript(table) {
    if (!isFixedScript(table))
        return;
    if (table.records.length > SCRIPT_ROW_LIMIT)
        throw new Error('每张剧本解析表最多 10 行，请将超出的任务放入下一张表；本次修改未应用');
    if (table.fields.length !== 4 || table.fields.some((f, i) => f.id !== ids[i] || f.hidden))
        throw new Error('剧本解析表固定为镜号/序号、画面描述、画面参考、备注四列');
    if (table.fields[2]?.type !== 'content' || table.fields.some((f, i) => i !== 2 && !(['text', 'longtext', 'json'].includes(f.type))))
        throw new Error('剧本解析表的文字和参考图片列类型不可互换');
}
function assertIdle(pages) {
    if (pages.some(p => p.table.records.some(r => Object.values(r.meta?.generationColumns || {}).some((s) => active.has(s.phase)))))
        throw new Error('生成任务进行中，暂不能调整解析或拆表');
}
function documentRecord(n) {
    // Keep unknown normalized data as well as the original inventory, including non-visible roles.
    const { tasks, baseSnapshot, editTicket, ...rest } = n;
    return copy({ ...rest, tasks });
}
function freshRow(task, n, index) {
    const issues = copy(task.issues || []), refs = [];
    for (const o of task.images || []) {
        const asset = n.assets[o.asset_id];
        if (!asset?.url || asset.error) {
            issues.push(`${o.id} 图片无法读取，待补充`);
            continue;
        }
        refs.push({ id: crypto.randomUUID(), url: asset.url, kind: 'image', name: `${task.row_id} · 参考 ${refs.length + 1}`, ...(asset.filename ? { filename: asset.filename } : {}), subfolder: asset.subfolder || '', type: 'input', provenance: { document_id: n.document_id, occurrence_id: o.id, ...(o.cell_id ? { source_cell: o.cell_id } : {}), asset_id: asset.id || o.asset_id } });
    }
    const values = { 'sp-shot_no': task.values.shot_no?.trim() ? task.values.shot_no : String(index + 1), 'sp-scene': task.values.scene || '', 'sp-reference': refs, 'sp-notes': task.values.notes || '' };
    return { id: crypto.randomUUID(), selected: false, values, meta: { script_source: { source_key: task.source_key, document_id: n.document_id, filename: n.filename, row_id: task.row_id, table_id: task.table_id, chapter: task.chapter || '', chapter_key: task.chapter_key || `${n.document_id}:chapter:${task.chapter || ''}`, issues, sources: copy(task.sources || {}), context: copy(task.context || []) }, script_original: copy(task.original_cells || []), script_import_values: copy(values), script_original_values: copy(task.values) } };
}
function reconcile(old, next, conflicts) {
    const baseline = old.meta?.script_import_values || {}, fresh = copy(next.values), values = copy(old.values);
    if (!next.meta.script_original_values.shot_no?.trim() && baseline['sp-shot_no'])
        fresh['sp-shot_no'] = baseline['sp-shot_no'];
    // Occurrence identity survives reparsing even when the same binary occurs more than once.
    const previous = new Map((Array.isArray(old.values['sp-reference']) ? old.values['sp-reference'] : []).map((a) => [a.provenance?.occurrence_id, a]));
    for (const asset of fresh['sp-reference']) {
        const match = previous.get(asset.provenance.occurrence_id);
        if (match)
            asset.id = match.id;
    }
    for (const fid of ids) {
        if (same(values[fid], baseline[fid]))
            values[fid] = fresh[fid];
        else if (!same(values[fid], fresh[fid]))
            conflicts.push(`${old.meta.script_source?.row_id || old.id} · ${fid} 已编辑，保留当前内容`);
    }
    return { ...copy(old), values, meta: { ...copy(old.meta), ...next.meta, script_source: { ...copy(old.meta?.script_source), ...next.meta.script_source }, script_import_values: fresh } };
}
function edited(row) {
    return !row.meta?.script_import_values || Object.entries(row.values).some(([k, v]) => !same(v, row.meta.script_import_values[k])) || Object.keys(row.meta.generationColumns || {}).length > 0;
}
function rowChapter(row) { return row.meta?.script_source?.chapter_key || 'manual'; }
function addDocument(table, doc) {
    const documents = table.meta.script_parser.documents;
    const at = documents.findIndex(d => d.document_id === doc.document_id);
    if (at < 0)
        documents.push(copy(doc));
    else
        documents[at] = { ...documents[at], ...copy(doc) };
}
export function planScriptImport(current, normalized, mode = 'append') {
    if (!current.length)
        throw new Error('缺少剧本解析节点');
    if (current.some(p => !isFixedScript(p.table)))
        throw new Error('旧版表格请先使用“按四列与章节拆表”；原表格未改变');
    assertIdle(current);
    if (normalized.tasks.length > 500)
        throw new Error('文档任务超过 500 行，未截断');
    const sourceKeys = normalized.tasks.map(t => t.source_key);
    if (new Set(sourceKeys).size !== sourceKeys.length)
        throw new Error('解析结果包含重复来源行');
    const pages = copy(current), conflicts = [], rows = new Map();
    for (const page of pages)
        for (const row of page.table.records) {
            const key = row.meta?.script_source?.source_key;
            if (key) {
                if (rows.has(key))
                    throw new Error('多个表存在重复来源，请先核对复制的记录');
                rows.set(key, { row, page });
            }
        }
    if (mode === 'replace')
        for (const page of pages) {
            page.table.records = [];
            page.table.meta.script_parser.documents = [];
            delete page.table.meta.script_parser.chapter_key;
        }
    const pending = [], wanted = new Set(sourceKeys);
    let added = 0, skipped = 0;
    normalized.tasks.forEach((task, index) => {
        const old = mode === 'replace' ? undefined : rows.get(task.source_key);
        if (old && mode === 'append') {
            skipped++;
            return;
        }
        let row = freshRow(task, normalized, index);
        if (old) {
            row = reconcile(old.row, row, conflicts);
            const i = old.page.table.records.indexOf(old.row);
            old.page.table.records[i] = row;
            if (rowChapter(row) !== old.page.table.meta.script_parser.chapter_key) {
                old.page.table.records.splice(i, 1);
                pending.push(row);
            }
        }
        else {
            pending.push(row);
            added++;
        }
    });
    if (mode === 'revise')
        for (const page of pages)
            page.table.records = page.table.records.filter(row => {
                if (row.meta?.script_source?.document_id !== normalized.document_id || wanted.has(row.meta.script_source.source_key))
                    return true;
                if (edited(row)) {
                    conflicts.push(`${row.meta.script_source.row_id} 已编辑，保留原记录`);
                    return true;
                }
                return false;
            });
    const doc = documentRecord(normalized);
    doc.conflicts = conflicts;
    for (const row of pending) {
        const chapter = rowChapter(row), candidates = pages.filter(p => p.table.meta.script_parser.chapter_key === chapter);
        let page = candidates.at(-1);
        if (!page || page.table.records.length >= SCRIPT_ROW_LIMIT) {
            page = pages.find(p => !p.table.records.length && !p.table.meta.script_parser.chapter_key);
            if (!page) {
                const template = rows.get(row.meta.script_source.source_key)?.page.table || candidates.at(-1)?.table;
                const table = emptyFixedScript();
                if (template) {
                    table.fields = copy(template.fields);
                    table.meta.generationInput = copy(template.meta.generationInput);
                }
                page = { key: crypto.randomUUID(), title: '', table };
                pages.push(page);
            }
            page.table.meta.script_parser.chapter_key = chapter;
            page.table.meta.script_parser.chapter = row.meta.script_source.chapter;
            page.title = `${row.meta.script_source.chapter || normalized.filename.replace(/\.docx$/i, '')} · ${candidates.length + 1}`;
        }
        page.table.records.push(row);
    }
    // Keep empty pages and their node connections after revision; never silently delete native nodes.
    for (const page of pages) {
        if (page.table.records.some(r => r.meta?.script_source?.document_id === normalized.document_id) || page.table.meta.script_parser.documents.some((d) => d.document_id === normalized.document_id) || page === pages[0])
            addDocument(page.table, doc);
        validateFixedScript(page.table);
    }
    return { pages, added, skipped, conflicts };
}
/** Explicit legacy conversion; retain the full old table and every original cell value. */
export function planLegacySplit(current) {
    assertIdle([current]);
    const old = current.table, bindings = old.meta.script_parser?.bindings || {}, docs = old.meta.script_parser?.documents || [];
    const pages = [];
    for (const original of old.records) {
        const source = copy(original.meta?.script_source || {}), chapter = String(original.values[bindings.chapter] || source.chapter || '');
        const chapterKey = source.chapter_key || `${source.document_id || 'legacy'}:chapter:${chapter}`;
        let page = pages.filter(p => p.table.meta.script_parser.chapter_key === chapterKey).at(-1);
        if (!page || page.table.records.length >= 10) {
            page = { key: pages.length ? crypto.randomUUID() : current.key, title: `${chapter || current.title} · ${pages.length + 1}`, table: emptyFixedScript() };
            page.table.meta.script_parser.documents = copy(docs);
            page.table.meta.script_parser.chapter_key = chapterKey;
            page.table.meta.script_parser.chapter = chapter;
            page.table.meta.script_parser.legacy_table = copy(old);
            pages.push(page);
        }
        const refs = (old.meta.script_parser?.reference_fields || []).flatMap((fid) => Array.isArray(original.values[fid]) ? copy(original.values[fid]) : []);
        const mapping = { [bindings.shot_no]: 'sp-shot_no', [bindings.scene]: 'sp-scene', [bindings.notes]: 'sp-notes' };
        for (const fid of old.meta.script_parser?.reference_fields || [])
            mapping[fid] = 'sp-reference';
        const remap = (value) => {
            if (!value || typeof value !== 'object' || Array.isArray(value))
                return copy(value);
            const doc = copy(value);
            if (Array.isArray(doc.references))
                for (const ref of doc.references) {
                    if (mapping[ref.fieldId])
                        ref.fieldId = mapping[ref.fieldId];
                    else
                        throw new Error('旧提示词引用了四列之外的字段，请先调整该引用后转换；原表未改变');
                }
            if (Array.isArray(doc.segments))
                doc.segments = doc.segments.map((s) => {
                    if (s.type !== 'column')
                        return s;
                    const value = original.values[s.fieldId];
                    if (mapping[s.fieldId] === 'sp-reference') {
                        const asset = Array.isArray(value) ? value.find((a) => s.assetId ? a.id === s.assetId : false) || value[s.assetIndex || 0] : null;
                        if (!asset)
                            throw new Error('旧提示词的图片引用无法解析，请先修正后转换；原表未改变');
                        return { ...s, fieldId: 'sp-reference', assetId: asset.id };
                    }
                    if (mapping[s.fieldId])
                        return { ...s, fieldId: mapping[s.fieldId] };
                    if (['string', 'number', 'boolean'].includes(typeof value))
                        return { type: 'text', text: String(value) };
                    throw new Error('旧提示词引用了无法转换的字段，请先调整该引用；原表未改变');
                });
            return doc;
        };
        const values = { 'sp-shot_no': copy(original.values[bindings.shot_no] || String(old.records.indexOf(original) + 1)), 'sp-scene': remap(original.values[bindings.scene] || old.fields.find(f => f.id === bindings.scene)?.promptTemplate || ''), 'sp-reference': refs, 'sp-notes': remap(original.values[bindings.notes] || '') };
        for (const [fid, value] of Object.entries(values))
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const field = page.table.fields.find(f => f.id === fid);
                field.type = 'json';
                field.presentation = 'prompt';
            }
        const baseline = original.meta?.script_import_values || {}, baselineValues = { ...copy(values) };
        baselineValues['sp-reference'] = (old.meta.script_parser?.reference_fields || []).flatMap((fid) => Array.isArray(baseline[fid]) ? copy(baseline[fid]) : []);
        for (const [role, fid] of Object.entries({ shot_no: 'sp-shot_no', scene: 'sp-scene', notes: 'sp-notes' }))
            if (bindings[role] in baseline)
                baselineValues[fid] = remap(baseline[bindings[role]]);
        page.table.records.push({ ...copy(original), values, meta: { ...copy(original.meta), script_source: { ...source, chapter, chapter_key: chapterKey }, script_legacy_values: copy(original.values), script_import_values: baselineValues } });
    }
    if (!pages.length) {
        const table = emptyFixedScript();
        table.meta.script_parser.documents = copy(docs);
        table.meta.script_parser.legacy_table = copy(old);
        pages.push({ ...current, table });
    }
    return pages;
}
