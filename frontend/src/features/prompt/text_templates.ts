export const TEXT_TEMPLATES = [
    {id:'scene', label:'画面描述', text:'保留原文主体、动作和场景，明确景别、构图、光线与风格。仅输出可用于生成的画面描述，不增加原文没有的人物、事件或产品细节。'},
    {id:'camera', label:'镜头运动', text:'保留原文主体与场景，只整理镜头起止、景别、运动方向及时间变化；未指定时不编造镜头运动。仅输出镜头提示词，不添加新情节。'},
    {id:'references', label:'参考图引用', text:'保留输入中的参考图引用、序号及其对应关系，明确各参考图约束的主体、外观或风格；不虚构未提供的参考图，不修改引用标记。仅输出生成提示词。'},
] as const;
export const DEFAULT_TEXT_INSTRUCTION = TEXT_TEMPLATES.map(template=>template.text).join('\n');
