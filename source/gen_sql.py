import json, pathlib
sql = pathlib.Path('sql/parts.sql').read_text().rstrip() + '\n\n' + pathlib.Path('sql/security.sql').read_text()
pathlib.Path('sql/setup.sql').write_text(sql)
pathlib.Path('src/setupSql.ts').write_text('// Generated from sql/parts.sql + sql/security.sql by gen_sql.py\nexport const SETUP_SQL = ' + json.dumps(sql) + '\n')
