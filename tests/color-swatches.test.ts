import { expect, it } from 'vitest';
import { newLayer, newProject, type Vector } from '../packages/document/src';
import { collectProjectSwatches, loadSwatches, STARTER_SWATCHES } from '../apps/editor/src/color-swatches';

it('collects distinct authored colors across scenes, symbols and animation', () => {
  const project = newProject();
  const paint: Vector = {id:'fill', kind:'rectangle', x:10, y:10, width:20, height:20, rotation:0,
    fill:'#112233', stroke:'#ABCDEF', strokeWidth:3, points:[]};
  const [layer] = project.layers;
  layer.keys[0].shapes = [paint];
  layer.keys.push({frame:2, shapes:[{...paint, fill:'#abcDEF'}]});
  layer.motionSpans = [{ id:'tween', start:0, end:2, ease:'linear', baseline:'',
    strokeColorKeys:[{offset:1,color:'#245980'}] }];
  const inactive = newLayer('Inactive');
  inactive.outlineColor = '#ffe8ab';
  inactive.keys[0].shapes = [{...paint, fill:'#ddbb77', strokeWidth:0}];
  project.scenes = {activeId:'main', entries:[{id:'main',name:'Main'},
    {id:'second',name:'Second',data:{layers:[inactive],duration:10}}]};
  const extra = newLayer('Animated symbol artwork');
  extra.keys[0].shapes = [{...paint, fill:'#f0b332', strokeWidth:0}];
  project.symbols = [{id:'symbol', name:'Symbol', width:60, height:60,
    shapes:[{...paint, kind:'text', fill:'#025692', strokeWidth:0, text:{content:'Hi', font:'Arial',
      size:12, bold:false, italic:false, align:'left', runs:[{start:0,end:1,style:{color:'#ac0199'}}]}}],
    timeline:{duration:5,layers:[extra],keys:[{frame:1,shapes:[{...paint, strokeWidth:0,
      gradient:{kind:'linear',from:{x:0,y:0},to:{x:10,y:10},stops:[{offset:0,color:'#ff9900'},
        {offset:1,color:'#002388'}]}, tint:{color:'#291619',amount:.4}}]}]}}];
  expect(collectProjectSwatches([project, project]).sort()).toEqual([
    '#ffffff', '#112233', '#abcdef', '#245980', '#ffe8ab', '#ddbb77', '#f0b332',
    '#025692', '#ac0199', '#ff9900', '#002388', '#291619',
  ].sort());
});

it('restores an edited palette with canonical hex and keeps a fallback for invalid storage', () => {
  expect(loadSwatches({getItem:()=>'["#AbC","#aabbcc","123456"]'})).toEqual(['#aabbcc','#123456']);
  expect(loadSwatches({getItem:()=>'["corrupt"]'})).toEqual(STARTER_SWATCHES);
  expect(loadSwatches({getItem:()=>'[]'})).toEqual([]);
});
