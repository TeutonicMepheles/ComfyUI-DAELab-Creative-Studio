"""Exact historical native schemas. No provider imports, auth hooks or execution."""
import copy

GPT_ID = "DAELAB.ComfyTV.GPTImageStoryboardStage"
BATCH_ID = "DAELAB.LibTV.StoryboardBatch"
GPT_WIDGETS = ("force_run_token", "project_id", "parent_output_id", "workflow", "size", "custom_width",
               "custom_height", "background", "quality", "seed", "control_after_generate", "main_prompt",
               "storyboard_data", "selected_index", "custom_params")
BATCH_WIDGETS = ("project_uuid", "request_id", "model", "mode", "duration", "resolution", "ratio", "sound")
SIZE_OPTIONS = ("auto", "1024x1024", "1024x1536", "1536x1024", "2048x2048", "2048x1152", "1152x2048", "3840x2160", "2160x3840", "Custom")
WORKFLOW_LABEL = "OpenAI GPT Image 2 (Comfy Credits)"
MODELS = ("Seedance 2.5", "Seedance 2.0", "Seedance 2.0 Mini", "Seedance 2.0 Fast", "Minimax H3")


class _ReadOnly:
    DEPRECATED = True
    CATEGORY = "DAELab/Legacy (read only)"
    FUNCTION = "execute"
    OUTPUT_NODE = True
    DESCRIPTION = "历史兼容只读节点。参数、结果和原生连线保留；执行已禁用，请先预览并显式转换。"

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return "历史兼容节点不可执行；请显式转换，或停用该节点后运行其他流程。"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")  # Never reuse a historical cached execution as new output.

    def execute(self, **kwargs):
        raise RuntimeError("历史兼容节点只读：未提交、恢复或重跑任何任务。")


class ReadOnlyGPTStoryboard(_ReadOnly):
    RETURN_TYPES = ("COMFYTV_IMAGES", "COMFYTV_IMAGE")
    RETURN_NAMES = ("images", "image")

    @classmethod
    def INPUT_TYPES(cls):
        hidden = {"socketless": True, "hidden": True}
        return {"required": {
            "force_run_token": ("INT", {"default": 0, "min": 0, "max": 2147483647, "step": 1, **hidden}),
            "project_id": ("STRING", {"default": "", **hidden}),
            "parent_output_id": ("INT", {"default": 0, "min": 0, "max": 2147483647, **hidden}),
            "workflow": ([WORKFLOW_LABEL], {"default": WORKFLOW_LABEL}),
            "size": (list(SIZE_OPTIONS), {"default": "auto"}),
            "custom_width": ("INT", {"default": 1024, "min": 1024, "max": 3840, "step": 16}),
            "custom_height": ("INT", {"default": 1024, "min": 1024, "max": 3840, "step": 16}),
            "background": (["auto", "opaque"], {"default": "auto"}),
            "quality": (["low", "medium", "high"], {"default": "low"}),
            "seed": ("INT", {"default": 0, "min": 0, "max": 2147483647, "step": 1}),
            "main_prompt": ("STRING", {"default": "", "multiline": True, **hidden}),
            "storyboard_data": ("STRING", {"default": "", **hidden}),
            "selected_index": ("INT", {"default": 1, "min": 1, "max": 999, "step": 1, **hidden}),
            "custom_params": ("STRING", {"default": "{}", **hidden}),
        }, "optional": {"imported_storyboard": ("STRING", {"forceInput": True})}}


class ReadOnlyStoryboardBatch(_ReadOnly):
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("batch_report", "video_paths")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "storyboard_json": ("STRING", {"forceInput": True}),
            "project_uuid": ("STRING", {"default": ""}),
            "request_id": ("STRING", {"default": "video-001"}),
            "model": (list(MODELS), {"default": "Seedance 2.0"}),
            "mode": (["text2video", "singleImage2video", "frames2video", "image2video", "mixed2video"], {"default": "mixed2video"}),
            "duration": ("INT", {"default": 5, "min": 4, "max": 30}),
            "resolution": (["480p", "720p", "1080p", "4k", "768P", "2K"], {"default": "720p"}),
            "ratio": (["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"], {}),
            "sound": ("BOOLEAN", {"default": False}),
        }}


def native_readonly_mappings():
    """Only the two historically native nodes; four old prototypes remain frontend types."""
    return {GPT_ID: ReadOnlyGPTStoryboard, BATCH_ID: ReadOnlyStoryboardBatch}


def schema_contract():
    return {name: {"inputs": copy.deepcopy(cls.INPUT_TYPES()), "outputs": list(cls.RETURN_TYPES),
                   "outputNames": list(cls.RETURN_NAMES), "widgets": list(GPT_WIDGETS if name == GPT_ID else BATCH_WIDGETS)}
            for name, cls in native_readonly_mappings().items()}
