import {test, expect} from '@playwright/test';

// A real PDF with nested bookmarks, named destinations, a broken destination,
// and text headings: no PDF.js or DOM mocking.
function fixture({bookmarks=true, headings=false}={}) {
  const objects=['', '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>'];
  for(let i=0;i<3;i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents ${4+i*2} 0 R >>`);
    const stream=headings?`BT /F1 18 Tf 50 700 Td (${['1 Introduction','1.1 Background','2 Results'][i]}) Tj ET`:'';
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects[0]=`<< /Type /Catalog /Pages 2 0 R ${bookmarks?'/Outlines 10 0 R /Names << /Dests << /Names [(results) [7 0 R /Fit]] >> >>':''} >>`;
  if(bookmarks) objects.push(
    '<< /Type /Outlines /First 11 0 R /Last 13 0 R /Count 4 >>',
    '<< /Title (Introduction) /Parent 10 0 R /Dest [3 0 R /Fit] /First 12 0 R /Last 12 0 R /Count 1 /Next 13 0 R >>',
    '<< /Title (Background) /Parent 11 0 R /Dest [5 0 R /Fit] >>',
    '<< /Title (Results) /Parent 10 0 R /Prev 11 0 R /Next 14 0 R /Dest (results) >>',
    '<< /Title (Unavailable) /Parent 10 0 R /Prev 13 0 R /Dest (missing) >>');
  let text='%PDF-1.4\n';const offsets=[0];
  objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${o}\nendobj\n`});
  const xref=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}
async function setup(page, options={}) {
  await page.route('**/api/**', route=>{
    const url=new URL(route.request().url()), p=url.pathname;
    const json=value=>route.fulfill({json:value});
    if(p==='/api/projects')return json([{id:'default',name:'默认项目'}]);
    if(p==='/api/health')return json({harness:{configured:true}});
    if(p==='/api/papers')return json([{id:'one',title:'Outline paper',page_count:3},{id:'two',title:'Blank paper',page_count:3}]);
    if(p.endsWith('/pdf'))return route.fulfill({contentType:'application/pdf',body:fixture(p.includes('/two/')?{bookmarks:false}:options)});
    if(p.endsWith('/conversations'))return json([{id:'default',title:'默认对话'}]);
    return json([]);
  });
  await page.goto('/');
  await expect(page.getByLabel('PDF 连续阅读').locator('canvas').first()).toBeVisible();
}

test('native nested bookmarks navigate, follow scroll, search and collapse without remounting PDF',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await setup(page);
  const toggle=page.getByRole('button',{name:'论文目录',exact:true});await expect(toggle).toHaveAttribute('aria-expanded','false');
  await toggle.click();const toc=page.getByRole('navigation',{name:'论文目录'});
  await expect(toc).toContainText('PDF 书签');
  await expect(toc.getByRole('button',{name:'Background · 第 2 页',exact:true})).toBeVisible();
  await expect(toc.getByRole('button',{name:'Unavailable · 无法定位',exact:true})).toBeDisabled();
  await toc.getByRole('button',{name:'Results · 第 3 页',exact:true}).click();
  await expect(page.getByLabel('页码',{exact:true})).toHaveValue('3');
  await expect(toc.getByRole('button',{name:'Results · 第 3 页',exact:true})).toHaveAttribute('aria-current','location');
  await page.getByLabel('PDF 连续阅读').evaluate(el=>el.scrollTop=0);
  await expect(toc.getByRole('button',{name:'Introduction · 第 1 页',exact:true})).toHaveAttribute('aria-current','location');
  await toc.getByRole('button',{name:'折叠 Introduction',exact:true}).click();
  await expect(toc.getByRole('button',{name:'Background · 第 2 页',exact:true})).toHaveCount(0);
  await toc.getByLabel('搜索目录').fill('background');
  await expect(toc.getByRole('button',{name:'Background · 第 2 页',exact:true})).toBeVisible();
  await toc.getByRole('button',{name:'Background · 第 2 页',exact:true}).click();
  await expect(page.getByLabel('页码',{exact:true})).toHaveValue('2');
  await toc.getByLabel('搜索目录').fill('no match');await expect(toc).toContainText('没有匹配的章节');
  await toc.getByLabel('搜索目录').fill('');
  await page.locator('[data-page="1"]').evaluate(el=>el.dataset.marker='stable');
  await page.screenshot({path:info.outputPath('pdf-toc.png')});
  await page.keyboard.press('Escape');await expect(toc).toHaveCount(0);await expect(toggle).toBeFocused();
  await expect(page.locator('[data-page="1"]')).toHaveAttribute('data-marker','stable');
  await toggle.click();await page.locator('.paper-item').filter({hasText:'Blank paper'}).click();
  await expect(toc).toHaveCount(0);await toggle.click();await expect(toc).toContainText('未发现可靠的章节标题');
  expect(errors).toEqual([]);
});

test('no bookmarks: explicitly labelled candidates come from real text, not fabricated pages',async({page})=>{
  await setup(page,{bookmarks:false,headings:true});await page.getByRole('button',{name:'论文目录',exact:true}).click();
  const toc=page.getByRole('navigation',{name:'论文目录'});
  await expect(toc).toContainText('候选目录');await expect(toc).toContainText('自动提取');
  await toc.getByRole('button',{name:'2 Results · 第 3 页',exact:true}).click();await expect(page.getByLabel('页码',{exact:true})).toHaveValue('3');
});

test('empty PDF has honest empty state; narrow panel stays inside reader',async({page})=>{
  await setup(page,{bookmarks:false});await page.setViewportSize({width:900,height:800});
  await page.getByRole('button',{name:'论文目录',exact:true}).click();const toc=page.getByRole('navigation',{name:'论文目录'});
  await expect(toc).toContainText('未发现可靠的章节标题');await expect(toc.getByRole('button',{name:/第 .* 页/})).toHaveCount(0);
  expect(await toc.evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('main').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right&&el.scrollWidth<=el.clientWidth})).toBe(true);
});

test('Cmd/Ctrl+F searches the full text, cycles matches and clears highlights',async({page})=>{
  await setup(page,{bookmarks:false,headings:true});await page.keyboard.press('ControlOrMeta+f');
  const bar=page.getByRole('search',{name:'在论文中搜索'}),input=bar.getByLabel('搜索论文全文');await expect(input).toBeFocused();
  await input.fill('1');await expect(bar).toContainText('1 / 3');await input.press('Enter');await expect(bar).toContainText('2 / 3');await expect(page.getByLabel('页码',{exact:true})).toHaveValue('2');
  await input.press('Shift+Enter');await input.press('Shift+Enter');await expect(bar).toContainText('3 / 3');
  await input.fill('RESULTS');await expect(bar).toContainText('1 / 1');await expect(page.getByLabel('页码',{exact:true})).toHaveValue('3');
  const active=page.locator('[data-page="3"] .mark.search-active');await expect(active).toHaveCount(1);
  const [box,pageBox]=await Promise.all([active.boundingBox(),page.locator('[data-page="3"]').boundingBox()]);expect(box.y-pageBox.y).toBeLessThan(pageBox.height*0.2);
  await input.fill('missing words');await expect(bar).toContainText('无结果');await expect(page.locator('.mark')).toHaveCount(0);
  await input.fill('results');await expect(active).toHaveCount(1);await input.press('Escape');await expect(bar).toHaveCount(0);await expect(page.locator('.mark')).toHaveCount(0);
});
