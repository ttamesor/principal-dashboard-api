import sql from 'mssql';

const config = {
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  options: {
    encrypt: true
  }
};

export default async function handler(req, res) {
  try {
    await sql.connect(config);

    const result = await sql.query`
      SELECT TOP 20
        h.DocType,
        h.DocStatus,
        COUNT(*) AS DocCount
      FROM DocumentHeaders h
      GROUP BY h.DocType, h.DocStatus
    `;

    res.status(200).json(result.recordset);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}