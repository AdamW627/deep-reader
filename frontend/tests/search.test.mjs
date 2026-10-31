import test from 'node:test';
import assert from 'node:assert/strict';
import {findInPage,indexPage} from '../src/search.js';

const viewport={width:600,height:800,convertToViewportRectangle:([x0,y0,x1,y1])=>[x0,800-y0,x1,800-y1]};
const items=[
 {str:'Residual   Learning',transform:[10,0,0,10,100,700],width:190,height:10,hasEOL:true},
 {str:'residual block',transform:[10,0,0,10,100,680],width:140,height:10},
];

test('matches ignore case and repeated whitespace across lines',()=>{
 const index=indexPage(items);
 assert.equal(index.text,'residual learning residual block');
 assert.equal(findInPage(index,'RESIDUAL',items,viewport).length,2);
 const across=findInPage(index,'learning residual',items,viewport);
 assert.equal(across.length,1);
 assert.equal(across[0].length,2);
});
test('match rectangles are normalized to the page',()=>{
 const [[rect]]=findInPage(indexPage(items),'block',items,viewport);
 assert.ok(rect.x>0.2&&rect.x<0.4&&rect.width>0&&rect.width<0.1);
 assert.ok(rect.y>0.1&&rect.y<0.16&&rect.height>0);
 assert.deepEqual(findInPage(indexPage(items),'   ',items,viewport),[]);
});

test('custom measure positions matches by rendered glyph width',()=>{
  const items=[{str:'iiWW',width:100,height:10,transform:[10,0,0,10,0,0]}];
  const viewport={width:100,height:100,convertToViewportRectangle:([x0,y0,x1,y1])=>[x0,100-y1,x1,100-y0]};
  const widths={i:1,W:4};
  const [[rect]]=findInPage(indexPage(items),'ww',items,viewport,(item,text)=>[...text].reduce((s,c)=>s+widths[c],0));
  assert.ok(Math.abs(rect.x-0.2)<1e-9);assert.ok(Math.abs(rect.width-0.8)<1e-9);
});
