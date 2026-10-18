import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {renderKitchenTicket,printerAllowed,spoolLocalPrinter} from '../../../scripts/r4-print-agent.mjs';

test('KDS agent safely renders sanitized ticket without extra commands or personal address',()=>{
 const value=renderKitchenTicket({id:'job-1',printerName:'cozinha',payload:{jobFormat:'R4_KITCHEN_V1',
   orderId:'order-1',ticketNumber:22,items:[{name:'Pizza\\nDROP TABLE',quantity:2}]}});
 assert.match(value,/22/);
 assert.match(value,/Pizza\\nDROP TABLE/);
 assert.ok(!value.includes('\\nDROP TABLE\\n'));
 assert.equal(printerAllowed('cozinha',['cozinha']),true);
 assert.equal(printerAllowed('cozinha;rm -rf /',['cozinha']),false);
});

test('KDS agent calls CUPS using argv, never shell or interpreted product commands',async()=>{
 const seen=[];
 const launch=(program,args,options)=>{
   seen.push({program,args,options});
   const child=new EventEmitter();
   child.stderr=new EventEmitter();
   child.stdin={on(){},end(text){seen.push({text});queueMicrotask(()=>child.emit('close',0));}};
   return child;
 };
 await spoolLocalPrinter('cozinha;$(bad)','1 x Pizza',{platform:'linux',launch});
 assert.equal(seen[0].program,'lp');
 assert.deepEqual(seen[0].args,['-d','cozinha;$(bad)']);
 assert.equal(seen[0].options.shell,false);
 assert.equal(seen[1].text,'1 x Pizza');
});

test('KDS agent uses Windows Out-Printer with printer name passed only as an environment variable',async()=>{
 let actual;
 const launch=(program,args,options)=>{
   actual={program,args,options};
   const child=new EventEmitter();
   child.stderr=new EventEmitter();
   child.stdin={on(){},end(){queueMicrotask(()=>child.emit('close',0));}};
   return child;
 };
 await spoolLocalPrinter('Cozinha & Teste','Ticket',{platform:'win32',launch});
 assert.equal(actual.program,'powershell.exe');
 assert.equal(actual.options.env.PDV_AGENT_PRINTER,'Cozinha & Teste');
 assert.ok(!actual.args.join(' ').includes('Cozinha & Teste'));
 assert.equal(actual.options.shell,false);
});
