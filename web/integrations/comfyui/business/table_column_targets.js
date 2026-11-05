// @ts-expect-error Mature ESM material rules are shared by both table adapters.
import { columnDropTypes, columnFillCount, addMaterialColumns, fillMaterialColumn, fillMaterialRow, fillMaterialCell } from '../../../application/table_material_columns.mjs';
/** Native IO serialization may omit custom input fields; node properties are canonical. */
export function restoreBoundColumnInputs(node) {
    if (!node.properties)
        return;
    const raw = node.properties.daelabColumnSlots, slots = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    for (const input of node.inputs || [])
        if (input.daeColumnField && input.name)
            slots[input.daeColumnField] = input.name;
    const rawBindings = node.properties.daelabColumnBindings, bindings = rawBindings && typeof rawBindings === 'object' ? rawBindings : {};
    for (const [field, binding] of Object.entries(bindings)) {
        const byLink = binding.inputLink != null ? node.inputs?.find(input => input.link != null && String(input.link) === String(binding.inputLink)) : undefined;
        const byName = node.inputs?.find(input => input.name === binding.inputName) || node.inputs?.find(input => input.name === slots[field]);
        const claimed = byName?.link != null && Object.entries(bindings).some(([other, value]) => other !== field && value.inputLink != null && String(value.inputLink) === String(byName.link));
        const input = byLink || node.inputs?.find(input => input.daeColumnField === field) || (!claimed ? byName : undefined);
        if (input?.name) {
            input.daeColumnField = field;
            slots[field] = input.name;
        }
    }
    if (!Object.keys(slots).length)
        return;
    node.properties.daelabColumnSlots = slots;
    for (const [field, name] of Object.entries(slots))
        if (!bindings[field] && typeof name === 'string') {
            const input = node.inputs?.find(input => input.name === name);
            if (input && (!input.daeColumnField || input.daeColumnField === field))
                input.daeColumnField = field;
        }
}
export function boundColumnTargets(node, targets) {
    restoreBoundColumnInputs(node);
    for (const target of targets)
        if (target.project)
            Object.assign(target, { inputIndex: (node.inputs || []).findIndex(input => input.daeColumnField === target.key) });
    return targets;
}
/** Native panel descriptors; the Canvas owns Slot appearance and projection. */
export function tableColumnTargets(root, fields) {
    if (!root)
        return [];
    const cells = Array.from(root.querySelectorAll('td[data-field]'));
    return Array.from(root.querySelectorAll('th[data-column]')).flatMap(element => {
        const field = fields.find(field => field.id === element.dataset.column);
        const accepts = columnDropTypes(field);
        if (!field || !accepts.length)
            return [];
        const columnCells = cells.filter(cell => cell.dataset.field === field.id);
        return [{ element, key: field.id, project: true,
                label: '单个素材填满整列，多个素材按序向下填充', accepts,
                clipElement: element.closest('.dae-table-scroll'),
                previewElements: (count) => [element, ...columnCells.slice(0, columnFillCount(count, columnCells.length))],
            }];
    });
}
/** Shared complete table drop surface, including non-projected cell/row inputs. */
export function tableMaterialTargets(root, fields) {
    if (!root)
        return [];
    const projected = tableColumnTargets(root, fields);
    const ids = new Set(fields.filter(field => columnDropTypes(field).includes('image')).map(field => field.id));
    const cells = Array.from(root.querySelectorAll('td[data-field]')).filter(cell => ids.has(cell.dataset.field));
    const target = (element, key, label) => ({ element, key, label, project: false, clipElement: element.closest('.dae-table-scroll') });
    const add = root.querySelector('th.table-add-column');
    return [...projected,
        ...(add ? [{ ...target(add, JSON.stringify(['new-column']), '松开自动新建列，按顺序从首行填入'), accepts: ['image', 'video', 'text'] }] : []),
        ...Array.from(root.querySelectorAll('.table-choice[data-content-row]')).map(element => ({ ...target(element, JSON.stringify(['row', element.dataset.contentRow]), '松开按行向右填充'), previewElements: [element, ...cells.filter(cell => cell.dataset.record === element.dataset.contentRow)] })),
        ...cells.map(cell => target(cell, JSON.stringify(['cell', cell.dataset.record, cell.dataset.field]), '松开将全部素材加入此格'))];
}
export function fillTableMaterialTarget(table, key, collection) {
    if (table.fields.some(field => field.id === key)) {
        fillMaterialColumn(table, key, collection);
        return;
    }
    const [kind, record, field] = JSON.parse(key);
    if (kind === 'new-column')
        addMaterialColumns(table, collection);
    else if (kind === 'row')
        fillMaterialRow(table, record, collection);
    else if (kind === 'cell')
        fillMaterialCell(table, record, field, collection);
    else
        throw new Error('未知表格素材位置');
}
