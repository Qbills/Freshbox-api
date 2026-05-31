// ============================================================
// Pantri — Auto-populate product ingredients and steps
// Run from: C:\Users\Q\Downloads\FreshBoxAPI
// Command: node scripts/populate_products.js
// ============================================================

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Claude API call ───────────────────────────────────────────
async function generateProductDetails(productName, category, description) {
  const prompt = `You are a professional chef and food content writer for a South African meal kit delivery service called Pantri.

Generate realistic ingredients and cooking steps for this product:
Name: ${productName}
Category: ${category}
Description: ${description}

Return ONLY valid JSON in this exact format, no other text:
{
  "ingredients": [
    { "name": "ingredient name", "quantity": "amount as string", "unit": "g/ml/tbsp/tsp/whole/large/cloves etc", "is_allergen": false }
  ],
  "steps": [
    { "step_number": 1, "title": "Short title", "description": "Detailed instruction", "duration_mins": 5 }
  ]
}

Rules:
- 6-12 ingredients per product
- 4-6 cooking steps per product
- Mark allergens (gluten, dairy, nuts, eggs, shellfish) as is_allergen: true
- Use realistic South African measurements and ingredients
- Steps should be clear and achievable for home cooks
- For produce/wellness boxes, generate storage tips and serving suggestions as steps instead`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  const text = data.content[0].text.trim();

  // Strip markdown code fences if present
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();

  try {
    // Get all products that have no ingredients yet
    const productsResult = await client.query(
      `SELECT p.id, p.name, p.category, p.description
       FROM products p
       WHERE p.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM product_ingredients pi WHERE pi.product_id = p.id
       )
       ORDER BY p.display_order`
    );

    const products = productsResult.rows;
    console.log(`\nFound ${products.length} products without ingredients\n`);

    if (products.length === 0) {
      console.log('All products already have ingredients. Done.');
      return;
    }

    for (const product of products) {
      console.log(`Processing: ${product.name}...`);

      try {
        const details = await generateProductDetails(
          product.name,
          product.category,
          product.description
        );

        // Insert ingredients
        for (const ing of details.ingredients) {
          await client.query(
            `INSERT INTO product_ingredients (product_id, name, quantity, unit, is_allergen)
             VALUES ($1, $2, $3, $4, $5)`,
            [product.id, ing.name, ing.quantity?.toString(), ing.unit, ing.is_allergen || false]
          );
        }

        // Insert steps
        for (const step of details.steps) {
          await client.query(
            `INSERT INTO product_steps (product_id, step_number, title, description, duration_mins)
             VALUES ($1, $2, $3, $4, $5)`,
            [product.id, step.step_number, step.title, step.description, step.duration_mins || null]
          );
        }

        console.log(`  ✅ ${details.ingredients.length} ingredients, ${details.steps.length} steps added`);

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 1000));

      } catch (err) {
        console.log(`  ❌ Failed for ${product.name}:`, err.message);
      }
    }

    console.log('\n✅ All products populated successfully!\n');

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
