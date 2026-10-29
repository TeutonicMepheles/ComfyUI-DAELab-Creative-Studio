/** Resolve lineage through the bound group, or the legacy/single material input. */
export function generationOutputConnected(target, ownerId) {
    const graph = target.graph, binding = target.properties?.generationOutput;
    let receiver = target;
    if (binding?.groupId != null) {
        receiver = graph?.getNodeById(binding.groupId);
        if (receiver?.type !== 'DAELAB.MaterialGroup' || receiver.properties?.generationOutputOwner !== ownerId || !receiver.properties.members?.some((id) => String(id) === String(target.id)))
            return false;
    }
    const input = receiver.inputs?.find((slot) => slot.name === 'source_report');
    const link = graph?.links?.get?.(input?.link) ?? graph?.links?.[input?.link];
    const owner = link && graph.getNodeById(link.origin_id);
    return !!owner && String(owner.id) === ownerId && link.origin_slot === owner.outputs?.findIndex((slot) => slot.name === 'task_report');
}
