import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bulkReplaceOps, cloudDbReady, customerToDoc } from './cloudDb.js';
import { compactCustomer, compactPublicCard } from './dataPersistence.js';

describe('cloud database mapping', () => {
  it('is not ready without MONGODB_URI', () => {
    assert.equal(cloudDbReady(), Boolean(process.env.MONGODB_URI || process.env.MONGO_URL));
  });

  it('uses compact RFQ cards so 160k documents fit a free cluster', () => {
    const row = compactCustomer({
      id: 'alipub_1',
      company: 'Buyer',
      painPoints: 'x'.repeat(5000),
      publicCard: {
        rfqId: '1',
        subject: 'Drill bits',
        description: 'd'.repeat(4000),
        buyerName: 'Ali',
        country: 'United States',
      },
    });
    assert.equal(row.id, 'alipub_1');
    assert.ok(row.painPoints.length <= 1200);
    assert.equal(row.publicCard.description.length, 800);
    assert.equal(compactPublicCard(null), null);
    const doc = customerToDoc(row);
    assert.equal(doc._id, 'alipub_1');
    const ops = bulkReplaceOps([row, { name: 'skip me' }]);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].replaceOne.filter._id, 'alipub_1');
    assert.equal(ops[0].replaceOne.upsert, true);
  });
});
