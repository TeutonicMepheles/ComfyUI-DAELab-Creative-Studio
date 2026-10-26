"""Explicit business assembly. Importing this package registers and executes nothing."""


def register_nodes():
    from .table_node import DataTable
    from .script_node import ScriptParser
    from .import_node import StoryboardImport
    from .approved_result import ApprovedLLMResult
    return ({'DAELAB.Table': DataTable, 'DAELAB.ScriptParser': ScriptParser,
             'DAELAB.StoryboardImport': StoryboardImport,
             'DAELAB.LLMStylePreviewB': ApprovedLLMResult},
            {'DAELAB.Table': '多维表格', 'DAELAB.ScriptParser': '分镜剧本解析器',
             'DAELAB.StoryboardImport': '剧本分镜导入', 'DAELAB.LLMStylePreviewB': '已应用提示词'})


def register_routes(server, services):
    from ....storyboard import document_api, script_api
    from ....prompt import prompt_api
    from ....storyboard.http import register_definitions
    return register_definitions(server, services,
                                document_api.routes(services) + script_api.routes(services) + prompt_api.routes(services))
