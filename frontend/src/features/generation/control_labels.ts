/** Translate execution facts without changing the durable provider error. */
export function generationErrorText(error: unknown): string {
  const code = String(error || '');
  const labels: Record<string, string> = {
    remote_execution_interrupted_unknown: '本地执行已中断，远端结果待核实',
    remote_video_outcome_unknown: '本地执行异常，远端结果待核实',
    original_execution_missing: '原执行记录缺失，执行状态待核实',
    original_execution_unknown: '执行状态待核实',
    query_unavailable: '暂时无法查询原任务，请稍后核对；原任务结果尚未确认',
    original_query_unavailable: '当前无法查询原任务，请查看原任务记录及已有结果；未重新提交生成',
    recovery_limit_reached: '原任务核对次数已用尽，远端结果仍待确认；仍可查看旧任务与已有结果',
    native_execution_stopped: '本地执行已中断',
    interrupted_before_submit: '已中断，未提交生成',
  };
  return labels[code] || code;
}
