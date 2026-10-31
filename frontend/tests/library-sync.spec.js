import {test,expect} from '@playwright/test';

test('returning to an open reader refreshes shared papers without restoring another browser selection',async({page})=>{
 let papers=[],requests=0;
 await page.route('**/api/**',route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/projects')return route.fulfill({json:[{id:'default',name:'默认项目'}]});
  if(u.pathname==='/api/health')return route.fulfill({json:{harness:{configured:true}}});
  if(u.pathname==='/api/papers'){requests++;return route.fulfill({json:papers})}
  return route.fulfill({json:[]});
 });
 await page.goto('/');
 await expect.poll(()=>requests).toBe(1);
 papers=[{id:'external',title:'Imported from another browser',page_count:12,created_at:'2026-10-26'}];
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('.paper-item')).toContainText('Imported from another browser');
 await expect(page.locator('.reader-header')).toContainText('你的论文阅读工作台');
 await expect(page.getByRole('alert')).toHaveCount(0);
});
