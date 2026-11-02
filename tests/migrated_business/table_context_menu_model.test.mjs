import test from 'node:test';
import assert from 'node:assert/strict';
import {clampMenuPosition,menuNavigationIndex} from '../../frontend/src/application/table_presentation.mjs';

test('vertical context menu keyboard navigation skips disabled items and wraps',()=>{
 const enabled=[true,false,true,true];
 assert.equal(menuNavigationIndex(enabled,-1,'ArrowDown'),0);
 assert.equal(menuNavigationIndex(enabled,0,'ArrowDown'),2);
 assert.equal(menuNavigationIndex(enabled,2,'ArrowUp'),0);
 assert.equal(menuNavigationIndex(enabled,3,'ArrowDown'),0);
 assert.equal(menuNavigationIndex(enabled,-1,'End'),3);
 assert.equal(menuNavigationIndex(enabled,3,'Home'),0);
});

test('context menu stays inside viewport and flips before it would overflow',()=>{
 const bounds={left:20,top:30,right:1020,bottom:730};
 assert.deepEqual(clampMenuPosition({x:900,y:680},{width:240,height:220},bounds),{left:772,top:452});
 assert.deepEqual(clampMenuPosition({x:35,y:40},{width:240,height:220},bounds),{left:35,top:40});
});
