# 旧收藏导入

`favorites.py` 负责 `normalize_favorite` 与 `import_browser_favorites`：校验旧条目、保持来源身份，再交给当前 AssetCatalog 导入。资产路径解析与持久化由 `backend/assets/` 拥有。

验证：`python -m unittest discover -s tests/migration -p 'test_*.py' -v`。重复导入、混合有效/无效记录及来源身份应保持可核对。
