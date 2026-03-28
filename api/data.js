import sql from 'mssql';

const config = {
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  options: { encrypt: true, trustServerCertificate: false }
};

const ITEM_FILTER  = `i.LineType = 1`;
const DATE_FLOOR   = `'2026-01-01'`;

const ITEM_COLS = `
  i.ID              AS ItemID,
  i.DocID,
  i.Description,
  i.Manufacturer,
  i.ManufacturerPartNumber,
  i.QtyTotal,
  i.UnitPrice,
  i.UnitCost,
  i.ExtendedPrice,
  i.CustomDate01    AS DeliveryDate,
  i.CustomText02    AS ShippedStatus,
  i.CustomText03    AS CustomText03,
  i.CustomText04    AS SerialNumber,
  i.Notes,
  DATEDIFF(day, GETDATE(), i.CustomDate01) AS DeliveryDays
`;

const HEADER_COLS = `
  h.DocNo,
  h.DocName,
  h.DocType,
  h.DocStatus,
  h.SoldToCompany,
  h.SoldToContact,
  h.SoldToPhone,
  h.SoldToEmail,
  h.SoldToAddress1,
  h.SoldToCity,
  h.SoldToPostalCode,
  h.SalesRep,
  h.DocDate,
  h.GrandTotal
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const {
    mode = 'stats',
    month, year,
    docType, status,
    page = '1',
    serial,
    itemId
  } = req.query;

  const pageSize = 150;
  const offset   = (parseInt(page) - 1) * pageSize;

  try {
    const pool = await sql.connect(config);
    let result;

    // ── STATS ──────────────────────────────────────────────────────────
    if (mode === 'stats') {
      result = await pool.request().query(`
        SELECT
          DocType,
          DocStatus,
          COUNT(*) AS DocCount,
          ISNULL(SUM(GrandTotal), 0) AS TotalValue,
          0 AS ShippedItems,
          0 AS UnshippedItems
        FROM DocumentHeaders
        WHERE Created >= ${DATE_FLOOR}
        GROUP BY DocType, DocStatus
        ORDER BY DocType, DocStatus
      `);
    }

    // ── CALENDAR ───────────────────────────────────────────────────────
    else if (mode === 'calendar') {
      const m = month ? parseInt(month) : new Date().getMonth() + 1;
      const y = year  ? parseInt(year)  : new Date().getFullYear();
      const r = pool.request();
      r.input('m', sql.Int, m);
      r.input('y', sql.Int, y);
      result = await r.query(`
        SELECT ${ITEM_COLS}, ${HEADER_COLS}
        FROM DocumentItems i
        INNER JOIN DocumentHeaders h ON i.DocID = h.ID
        WHERE i.CustomDate01 IS NOT NULL
          AND MONTH(i.CustomDate01) = @m
          AND YEAR(i.CustomDate01)  = @y
          AND h.Created >= ${DATE_FLOOR}
          AND ${ITEM_FILTER}
        ORDER BY i.CustomDate01 ASC
      `);
    }

    // ── UPCOMING (next 90 days) ─────────────────────────────────────────
    else if (mode === 'upcoming') {
      result = await pool.request().query(`
        SELECT TOP 300 ${ITEM_COLS}, ${HEADER_COLS}
        FROM DocumentItems i
        INNER JOIN DocumentHeaders h ON i.DocID = h.ID
        WHERE i.CustomDate01 IS NOT NULL
          AND i.CustomDate01 >= CAST(GETDATE() AS DATE)
          AND i.CustomDate01 <= DATEADD(day, 90, GETDATE())
          AND h.Created >= ${DATE_FLOOR}
          AND ${ITEM_FILTER}
        ORDER BY i.CustomDate01 ASC
      `);
    }

    // ── OVERDUE (past delivery date, not shipped) ───────────────────────
    else if (mode === 'overdue') {
      result = await pool.request().query(`
        SELECT TOP 300 ${ITEM_COLS}, ${HEADER_COLS}
        FROM DocumentItems i
        INNER JOIN DocumentHeaders h ON i.DocID = h.ID
        WHERE i.CustomDate01 IS NOT NULL
          AND i.CustomDate01 < CAST(GETDATE() AS DATE)
          AND (i.CustomText02 IS NULL OR i.CustomText02 NOT LIKE '%Shipped%')
          AND h.Created >= ${DATE_FLOOR}
          AND ${ITEM_FILTER}
        ORDER BY i.CustomDate01 ASC
      `);
    }

    // ── UNSHIPPED ──────────────────────────────────────────────────────
    else if (mode === 'unshipped') {
      result = await pool.request().query(`
        SELECT TOP 300 ${ITEM_COLS}, ${HEADER_COLS}
        FROM DocumentItems i
        INNER JOIN DocumentHeaders h ON i.DocID = h.ID
        WHERE (i.CustomText02 IS NULL OR i.CustomText02 NOT LIKE '%Shipped%')
          AND i.CustomDate01 IS NOT NULL
          AND h.Created >= ${DATE_FLOOR}
          AND ${ITEM_FILTER}
        ORDER BY i.CustomDate01 ASC
      `);
    }

    // ── SHIPPED ────────────────────────────────────────────────────────
    else if (mode === 'shipped') {
      result = await pool.request().query(`
        SELECT TOP 300 ${ITEM_COLS}, ${HEADER_COLS}
        FROM DocumentItems i
        INNER JOIN DocumentHeaders h ON i.DocID = h.ID
        WHERE i.CustomText02 LIKE '%Shipped%'
          AND h.Created >= ${DATE_FLOOR}
          AND ${ITEM_FILTER}
        ORDER BY i.CustomDate01 DESC
      `);
    }

    // ── DOCUMENT LIST ──────────────────────────────────────────────────
    else if (mode === 'list') {
      const r = pool.request();
      let where = `WHERE h.Created >= ${DATE_FLOOR}`;
      if (docType) { r.input('docType', sql.NVarChar, docType); where += ' AND h.DocType = @docType'; }
      if (status)  { r.input('status',  sql.NVarChar, status);  where += ' AND h.DocStatus = @status'; }
      r.input('offset',   sql.Int, offset);
      r.input('pageSize', sql.Int, pageSize);
      result = await r.query(`
        SELECT
          h.ID,
          h.DocNo,
          h.DocName,
          h.DocType,
          h.DocStatus,
          h.SoldToCompany,
          h.SoldToContact,
          h.SalesRep,
          h.DocDate,
          h.GrandTotal,
          COUNT(i.ID)                                                        AS ItemCount,
          SUM(CASE WHEN i.CustomText02 LIKE '%Shipped%' THEN 1 ELSE 0 END)  AS ShippedCount,
          MIN(i.CustomDate01)                                                AS EarliestDelivery,
          MAX(i.CustomDate01)                                                AS LatestDelivery
        FROM DocumentHeaders h
        LEFT JOIN DocumentItems i ON i.DocID = h.ID AND ${ITEM_FILTER}
        ${where}
        GROUP BY h.ID, h.DocNo, h.DocName, h.DocType, h.DocStatus,
                 h.SoldToCompany, h.SoldToContact, h.SalesRep, h.DocDate, h.GrandTotal
        ORDER BY h.DocDate DESC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `);
    }

    // ── SERIAL NUMBER SEARCH ───────────────────────────────────────────
    // No date floor - serial search spans all historical documents.
    else if (mode === 'search') {
      if (!serial) return res.status(400).json({ error: 'serial parameter required' });
      const r = pool.request();
      r.input('serial', sql.NVarChar, '%' + serial.trim() + '%');
      result = await r.query(`
        SELECT TOP 100
          ${ITEM_COLS},
          ${HEADER_COLS}
        FROM DocumentItems i
        INNER JOIN DocumentHeaders h ON i.DocID = h.ID
        WHERE i.CustomText04 LIKE @serial
        ORDER BY h.DocDate DESC
      `);
    }

    // ── ITEM DETAIL ────────────────────────────────────────────────────
    // No date floor - detail can be opened from search results on any doc.
    else if (mode === 'detail') {
      if (!itemId) return res.status(400).json({ error: 'itemId required' });
      const r = pool.request();
      r.input('itemId', sql.Int, parseInt(itemId));
      const detail = await r.query(`
        SELECT
          ${ITEM_COLS},
          ${HEADER_COLS},
          h.InternalNotes,
          h.SoldToAddress1,
          h.SoldToCity,
          h.SoldToPostalCode,
          h.ID AS HeaderID
        FROM DocumentItems i
        INNER JOIN DocumentHeaders h ON i.DocID = h.ID
        WHERE i.ID = @itemId
      `);
      return res.status(200).json(detail.recordset[0] || null);
    }

    else {
      return res.status(400).json({ error: 'Invalid mode: ' + mode });
    }

    res.status(200).json(result.recordset);

  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  } finally {
    try { await sql.close(); } catch (_) {}
  }
}
