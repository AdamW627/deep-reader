import test from 'node:test';
import assert from 'node:assert/strict';
import {destinationPage,readBookmarks,headingCandidates,nestHeadings,activeSection} from '../src/outline.js';

test('destinations support names, refs, zero-based indexes; invalid targets are never page one',async()=>{
 const doc={numPages:4,getDestination:async name=>name==='good'?[{num:7},'Fit']:null,getPageIndex:async ref=>{if(ref?.num===7)return 2;throw Error('bad ref')}};
 assert.equal(await destinationPage(doc,'good'),3);
 assert.equal(await destinationPage(doc,[0,'Fit']),1);
 for(const dest of ['missing',null,[],[-1],[4],[1.5],[{}]])assert.equal(await destinationPage(doc,dest),null);
 const tree=await readBookmarks(doc,[{title:' A\n title ',dest:'missing',items:[{title:'Child',dest:'good'}]}]);
 assert.equal(tree[0].title,'A title');assert.equal(tree[0].page,null);assert.equal(tree[0].children[0].page,3);
 assert.deepEqual(await readBookmarks(doc,[{title:'late'}],()=>true),[]);
});
test('real text extraction joins split headings and rejects prose, page numbers and equations',()=>{
 const item=(str,y)=>({str,transform:[1,0,0,1,0,y]});
 const headings=headingCandidates([item('1',700),item('Introduction',700),item('1.1 Background',650),item('42',600),item('2 x = y.',550),item('A normal sentence.',500),item('18 layers 27.94 27.88',450),item('0.01 to warm up training',400),item('method',350)],2);
 assert.deepEqual(headings.map(h=>h.title),['1 Introduction','1.1 Background']);
 const tree=nestHeadings(headings);assert.equal(tree.length,1);assert.equal(tree[0].children.length,1);
 assert.equal(activeSection(tree,1),undefined);assert.equal(activeSection(tree,2),headings[1].id);
});
test('active section follows page order even when bookmarks are unordered',()=>{
 const items=[{id:'later',page:8,children:[]},{id:'earlier',page:2,children:[{id:'nested',page:4,children:[]}]}];
 assert.equal(activeSection(items,6),'nested');assert.equal(activeSection(items,9),'later');
});
