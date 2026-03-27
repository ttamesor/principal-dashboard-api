import sql from 'mssql';

const config = {
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

export default async function handler(req, res) {
  try {
    await sql.connect(config);

    const { mode = 'stats' } = req.query;

    let result;

    // ── STATS ─────────────────────────────────────
    if (mode === 'stats') {
      result = await sql.query`
        SELECT
          h.DocType,
          h.DocStatus,
          COUNT(*) AS DocCount
        FROM DocumentHeaders h
        GROUP BY h.DocType, h.DocStatus
      `;
    }

    // ── CALENDAR ──────────────────────────────────
    else if (mode === 'calendar') {
     result = await sql.query`
  SELECT TOP 1000
    i.ID              AS ItemID,
    i.DocID,
    i.Description,
    i.Manufacturer,
    i.ManufacturerPartNumber,
    i.QtyTotal,
    i.UnitPrice,
    i.UnitCost,

    i.CustomDate01    AS DeliveryDate,
    i.CustomDate02    AS WarrantyExpiry,

    DATEDIFF(day, GETDATE(), i.CustomDate01) AS DeliveryDays,
    DATEDIFF(day, GETDATE(), i.CustomDate02) AS WarrantyDays,

    i.CustomText02    AS ShippedStatus,

    h.DocNo,
    h.DocName,
    h.SoldToCompany,
    h.SalesRep,
    h.DocDate,
    h.DocType,
    h.DocStatus,
    h.SalesRepFacingUrl

  FROM DocumentItems i
  INNER JOIN DocumentHeaders h ON i.DocID = h.ID

  WHERE i.CustomDate01 IS NOT NULL
    AND i.ItemType NOT IN ('4', '256')
    AND i.UnitPrice > 0

  ORDER BY i.CustomDate01 ASC
`;
    }

    // ── LIST ──────────────────────────────────────
    else if (mode === 'list') {
      result = await sql.query`
        SELECT TOP 200
          h.ID,
          h.DocNo,
          h.DocName,
          h.DocType,
          h.DocStatus,
          h.SoldToCompany,
          h.SalesRep,
          h.DocDate
        FROM DocumentHeaders h
        ORDER BY h.DocDate DESC
      `;
    }

    else {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    res.status(200).json(result.recordset);

  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await sql.close();
  }
}
