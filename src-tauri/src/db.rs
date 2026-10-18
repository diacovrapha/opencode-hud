use rusqlite::{types::ValueRef, Connection, OpenFlags};
use serde_json::{Map, Number, Value};

use crate::paths::db_path;

pub(crate) const QUERY_LIMIT: std::time::Duration = std::time::Duration::from_secs(10);

fn validate_select(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim_start();
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("select") || lower.starts_with("with")) {
        return Err("apenas SELECT/WITH são permitidos".to_string());
    }

    // Permite ';' somente no final (com whitespace depois, opcional).
    let trimmed_end = sql.trim_end();
    let bytes = trimmed_end.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        if b == b';' && i != bytes.len() - 1 {
            return Err("';' só é permitido no final da consulta".to_string());
        }
    }
    Ok(())
}

pub fn run_query(sql: &str, params: &[Value]) -> Result<Vec<Map<String, Value>>, String> {
    validate_select(sql)?;
    let path = db_path();
    if !path.exists() {
        return Err(format!("banco não encontrado em {}", path.display()));
    }

    let conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("abrir sqlite ({}): {e}", path.display()))?;

    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| format!("busy_timeout: {e}"))?;

    // Trava de segurança: nenhuma consulta pode rodar mais que QUERY_LIMIT.
    // (Uma CTE recursiva errada já prendeu uma thread para sempre.)
    let started = std::time::Instant::now();
    conn.progress_handler(10_000, Some(move || started.elapsed() > QUERY_LIMIT));

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("prepare: {e}"))?;

    let converted: Vec<Box<dyn rusqlite::ToSql>> = convert_params(params);

    let column_names: Vec<String> = stmt
        .column_names()
        .into_iter()
        .map(|c| c.to_string())
        .collect();

    let mut rows = stmt
        .query(rusqlite::params_from_iter(converted.iter().map(|b| b.as_ref())))
        .map_err(|e| format!("query: {e}"))?;

    let mut out: Vec<Map<String, Value>> = Vec::new();
    while let Some(row) = rows.next().map_err(|e| format!("next: {e}"))? {
        let mut map = Map::new();
        for (i, name) in column_names.iter().enumerate() {
            let v = row.get_ref(i).map_err(|e| format!("get_ref[{i}]: {e}"))?;
            let json = value_to_json(&v);
            map.insert(name.clone(), json);
        }
        out.push(map);
    }
    Ok(out)
}

fn value_to_json(v: &ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Number::from(*i).into(),
        ValueRef::Real(f) => Number::from_f64(*f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(s) => {
            let text = match std::str::from_utf8(s) {
                Ok(t) => t.to_string(),
                Err(_) => String::from_utf8_lossy(s).into_owned(),
            };
            Value::String(text)
        }
        ValueRef::Blob(_) => Value::Null,
    }
}

/// Converte `serde_json::Value` para os tipos aceitos por `rusqlite`.
fn convert_params(params: &[Value]) -> Vec<Box<dyn rusqlite::ToSql>> {
    let mut out: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(params.len());
    for p in params {
        match p {
            Value::Null => out.push(Box::new(Option::<i64>::None)),
            Value::Bool(b) => out.push(Box::new(*b as i64)),
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    out.push(Box::new(i));
                } else if let Some(f) = n.as_f64() {
                    out.push(Box::new(f));
                } else {
                    out.push(Box::new(n.to_string()));
                }
            }
            Value::String(s) => out.push(Box::new(s.clone())),
            other => out.push(Box::new(other.to_string())),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::db_path;

    #[test]
    fn rejects_non_select() {
        assert!(validate_select("DELETE FROM session").is_err());
        assert!(validate_select("INSERT INTO x VALUES (1)").is_err());
        assert!(validate_select("UPDATE x SET a = 1").is_err());
    }

    #[test]
    fn rejects_semicolon_inside() {
        assert!(validate_select("SELECT 1; DROP TABLE x").is_err());
        assert!(validate_select("SELECT 1; ").is_ok()); // espaço após o ; é permitido (final + ws)
        assert!(validate_select("SELECT 1;").is_ok());
    }

    #[test]
    fn allows_select_and_with() {
        assert!(validate_select("SELECT 1").is_ok());
        assert!(validate_select("select 1").is_ok());
        assert!(validate_select("WITH cte AS (SELECT 1) SELECT * FROM cte").is_ok());
    }

    #[test]
    fn real_db_count_sessions() {
        let path = db_path();
        if !path.exists() {
            // Se o opencode não estiver instalado neste host, pulamos silenciosamente.
            eprintln!("skip: db não existe em {}", path.display());
            return;
        }
        let rows = run_query("SELECT count(*) AS n FROM session", &[]).expect("query");
        let n = rows.first().and_then(|r| r.get("n")).cloned().unwrap_or(Value::Null);
        eprintln!("session count = {n}");
        assert!(matches!(n, Value::Number(_)));
    }

    #[test]
    fn runaway_query_is_interrupted() {
        if !db_path().exists() {
            return;
        }
        // CTE infinita: precisa ser interrompida pela trava de tempo.
        let t = std::time::Instant::now();
        let r = run_query(
            "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c",
            &[],
        );
        assert!(r.is_err());
        assert!(t.elapsed() < QUERY_LIMIT + std::time::Duration::from_secs(3));
    }
}