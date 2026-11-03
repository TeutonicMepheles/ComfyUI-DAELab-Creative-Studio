/** Translate execution facts without changing the durable provider error. */
export function generationErrorText(error: unknown): string {
  const code = String(error || '');
  const labels: Record<string, string> = {
    remote_execution_interrupted_unknown: '本地执行已中断，远端结果待核实',
    remote_video_outcome_unknown: '本地执行异常，远端结果待核实',
    original_execution_missing: '原执行记录缺失，执行状态待核实',
    original_execution_unknown: '执行状态待核实',
    native_execution_stopped: '本地执行已中断',
    interrupted_before_submit: '已中断，未提交生成',
  };
  return labels[code] || code;
}
