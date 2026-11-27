import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('listing metadata can be added, edited and cleared without changing fine weight', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table products(slug text, name text, metal text, metal_weight_oz numeric);
      insert into products values
      ('1-oz-rand-refinery-loxodonta-gold-bar-9999-fine','1 oz Rand Refinery Loxodonta Gold Bar – .9999 Fine Gold','gold',1),
      ('other','Other','silver',2)`);
    const migration = new URL('../supabase/migrations/20261127202300_listing_metal_specifications.sql', import.meta.url);
    await db.exec(readFileSync(migration, 'utf8'));
    const rows = (await db.query('select * from products order by metal')).rows;
    assert.equal(Number(rows[0].fineness), .9999);
    assert.equal(Number(rows[0].gold_karat), 24);
    assert.equal(Number(rows[0].gross_weight_g), 31.103);
    assert.equal(Number(rows[0].metal_weight_oz), 1);
    assert.equal(rows[1].fineness, null);
    for (const invalid of ['gold_karat=25', 'fineness=99.99', 'gross_weight_g=-1', 'gold_karat=22']) {
      await assert.rejects(db.exec("update products set " + invalid + " where metal='silver'"), {code: '23514'});
    }
    await db.exec("update products set fineness=.925,gross_weight_g=67.23 where metal='silver'");
    await db.exec("update products set fineness=null,gold_karat=null,gross_weight_g=null where metal='gold'");
    assert.equal((await db.query("select fineness from products where metal='gold'")).rows[0].fineness, null);
  } finally {
    await db.close();
  }
});
