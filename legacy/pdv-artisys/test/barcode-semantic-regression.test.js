'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const dense=require('../desktop/renderer/products-dense-view');

const components={
  SearchField:()=>'<input>',
  FilterBar:()=>'<div></div>',
  StatusBadge:status=>`<span>${status.label}</span>`,
  DataTable:({columns,rows})=>rows.map(row=>columns.map(column=>column.render?column.render(row):'').join('')).join('')
};

test('product barcode is rendered byte-for-byte in canonical product output and never reversed',()=>{
  const barcode='0007891234567';
  const reversed=[...barcode].reverse().join('');
  const html=dense.renderProductsDense({
    products:[{
      id:'p1',name:'Produto Barcode QA',sku:'QA-BAR-01',barcode,
      categoryName:'QA',salePriceCents:1234,stockQuantity:1,minimumStock:0,
      unit:'UN',trackStock:true,active:true
    }]
  },components);
  assert.match(html,new RegExp(barcode));
  assert.equal(html.includes(reversed),false);
});
