// FreshBoxAPI/src/routes/admin/products.js
// GET  /api/admin/products          — all products
// PUT  /api/admin/products/:id      — update product (availability, stock, price)

const express = require('express');
const router = express.Router();
const adminAuth = require('./middleware');

// GET /api/admin/products
router.get('/', adminAuth, async (req, res) => {
  const db = req.app.get('db');
  const { category, search } = req.query;

  try {
    let whereClauses = ['p.is_active = true'];
    const params = [];
    let paramIdx = 1;

    if (category && category !== 'all') {
      whereClauses.push(`p.category = $${paramIdx}`);
      params.push(category);
      paramIdx++;
    }

    if (search) {
      whereClauses.push(`p.name ILIKE $${paramIdx}`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereSQL = `WHERE ${whereClauses.join(' AND ')}`;

    const result = await db.query(
      `SELECT
         p.*,
         COUNT(DISTINCT pi.id) as ingredient_count,
         COUNT(DISTINCT ps.id) as step_count
       FROM products p
       LEFT JOIN product_ingredients pi ON pi.product_id = p.id
       LEFT JOIN product_steps ps ON ps.product_id = p.id
       ${whereSQL}
       GROUP BY p.id
       ORDER BY p.display_order ASC`,
      params
    );

    res.json({ products: result.rows });
  } catch (err) {
    console.error('GET /api/admin/products error:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// PUT /api/admin/products/:id — update availability or stock
router.put('/:id', adminAuth, async (req, res) => {
  const db = req.app.get('db');
  const { id } = req.params;
  const { is_available, stock_count, price, badge } = req.body;

  try {
    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (is_available !== undefined) {
      updates.push(`is_available = $${paramIdx}`);
      params.push(is_available);
      paramIdx++;
    }
    if (stock_count !== undefined) {
      updates.push(`stock_count = $${paramIdx}`);
      params.push(stock_count);
      paramIdx++;
    }
    if (price !== undefined) {
      updates.push(`price = $${paramIdx}`);
      params.push(price);
      paramIdx++;
    }
    if (badge !== undefined) {
      updates.push(`badge = $${paramIdx}`);
      params.push(badge);
      paramIdx++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    const result = await db.query(
      `UPDATE products SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ success: true, product: result.rows[0] });
  } catch (err) {
    console.error(`PUT /api/admin/products/${id} error:`, err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

module.exports = router;
