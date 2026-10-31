import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',use:{baseURL:'http://127.0.0.1:5199',viewport:{width:1440,height:1000}},webServer:{command:'npm run dev -- --port 5199 --strictPort',url:'http://127.0.0.1:5199',reuseExistingServer:false},reporter:'list'});
