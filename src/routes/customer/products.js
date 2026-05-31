// routes/customer/products.js
// FreshBoxAPI/src/routes/customer/products.js

const express = require('express');
const router = express.Router();
const customerAuth = require('../../middleware/customerAuth');

// GET /api/customer/products
router.get('/', customerAuth, async (req, res) => {
  const db = req.app.get('db');
  const { category, dietary, search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let whereClauses = ['p.is_active = true'];
    const params = [];
    let paramIndex = 1;

    if (category) {
      whereClauses.push(`p.category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    if (dietary) {
      const tags = dietary.split(',').map(t => t.trim());
      whereClauses.push(`p.dietary_tags && $${paramIndex}::text[]`);
      params.push(tags);
      paramIndex++;
    }

    if (search) {
      whereClauses.push(`(p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countResult = await db.query(
      `SELECT COUNT(*) FROM products p ${whereSQL}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(parseInt(limit), offset);
    const result = await db.query(
      `SELECT
         p.id, p.name, p.description, p.price, p.original_price,
         p.category, p.subcategory, p.image_url, p.dietary_tags,
         p.serves, p.prep_time_mins, p.calories_per_serving,
         p.is_available, p.stock_count, p.badge, p.rating, p.review_count
       FROM products p
       ${whereSQL}
       ORDER BY p.display_order ASC, p.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    res.json({
      products: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('GET /api/customer/products error:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /api/customer/products/categories
router.get('/categories', customerAuth, async (req, res) => {
  const db = req.app.get('db');
  try {
    const result = await db.query(
      `SELECT DISTINCT category, COUNT(*) as count
       FROM products
       WHERE is_active = true
       GROUP BY category
       ORDER BY category ASC`
    );
    res.json({ categories: result.rows });
  } catch (err) {
    console.error('GET /api/customer/products/categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// GET /api/customer/products/:id — uses separate subqueries to avoid duplicate rows
router.get('/:id', customerAuth, async (req, res) => {
  const db = req.app.get('db');
  const { id } = req.params;

  try {
    // 1. Fetch the product
    const productResult = await db.query(
      `SELECT * FROM products WHERE id = $1 AND is_active = true`,
      [id]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = productResult.rows[0];

    // 2. Fetch ingredients separately
    const ingredientsResult = await db.query(
      `SELECT name, quantity, unit, is_allergen as allergen
       FROM product_ingredients
       WHERE product_id = $1
       ORDER BY id ASC`,
      [id]
    );

    // 3. Fetch steps separately
    const stepsResult = await db.query(
      `SELECT step_number as step, title, description, duration_mins
       FROM product_steps
       WHERE product_id = $1
       ORDER BY step_number ASC`,
      [id]
    );

    product.ingredients = ingredientsResult.rows;
    product.steps = stepsResult.rows;

    res.json({ product });
  } catch (err) {
    console.error(`GET /api/customer/products/${id} error:`, err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

module.exports = router;