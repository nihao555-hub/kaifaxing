import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { peerKeyword, clusterDemandKeywords } from './demandPeers.js';

describe('demand peers', () => {
  it('uses a product phrase, not the nickname', () => {
    const customer = {
      company: 'Yash Kumar',
      categoryName: 'Packaging & Printing',
      publicCard: { subject: 'Custom Logo PP Woven Sack Plastic 50kg Copra Meal Packaging Bags' },
    };
    const key = peerKeyword(customer);
    assert.ok(key.length >= 4);
    assert.ok(!/Yash/i.test(key));
    assert.match(key, /Woven|Sack|Plastic|Packaging/i);
  });

  it('clusters nickname cards by product keyword', () => {
    const rows = [
      { company: 'A', publicCard: { subject: 'Hydraulic Scissor Lift Platform 8m' } },
      { company: 'B', publicCard: { subject: 'Hydraulic Scissor Lift Platform 10m' } },
      { company: 'C', publicCard: { subject: 'Hotel room amenity kit' } },
    ];
    const clusters = clusterDemandKeywords(rows, { maxClusters: 5 });
    assert.ok(clusters.length >= 1);
    assert.ok(clusters.every((x) => !/^(A|B|C)$/.test(x.keyword)));
  });
});
