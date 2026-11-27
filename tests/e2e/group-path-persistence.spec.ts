import { test, expect } from '@playwright/test';
import { build } from 'vite';
type API = typeof import('../group-path-browser-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/group-path-browser-fixture.ts',
        formats: ['iife'],
        name: 'GroupPaths',
        fileName: () => 'groups.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one independent group fixture');
  code = chunks[0].code;
});
for(const preparation of ['saved','private'])for(const basis of ['plain','affine','reflected'])for(const frame of [3,5])
  test(`${preparation==='private'?'private original-clock candidate':'restricted original arc'} ${basis} frame${frame} reopens with exact prepared-stage PNG pixels`,async({page})=>{
    await page.goto('/');await page.addScriptTag({content:code});
    const result=await page.evaluate(async({basis,frame,preparation})=>{
      const api=(window as unknown as {GroupPaths:API}).GroupPaths,data=api.restrictedArcProject(basis),p=data.p,source=JSON.stringify(p);
      let q=data.q;
      if(preparation==='private'){
        const scope=api.captureLiveGroupMotionAuthoringFrame(()=>({project:p,revision:0,frame:4}));
        q=api.prepareRestrictedArcLiveGroupMotionSpans([{owner:scope.resolve('track','outer'),rightSpanId:'private-right'}]);scope.dispose();
      }
      const reopened=api.migrateProject(JSON.parse(JSON.stringify(q))),before=JSON.stringify(reopened);
      const a=api.captureLiveMotionStage(()=>({project:p,revision:0})),b=api.captureLiveMotionStage(()=>({project:reopened,revision:0}));
      const projects=[a.sample(frame).project,b.sample(frame).project,await api.prepareLiveMotionFrameCapture(()=>({project:reopened,revision:0}),frame)];
      const pixels:Uint8ClampedArray[]=[];
      for(const project of projects){
        const image=await createImageBitmap(await api.exportPNGFrame(project,frame)),canvas=document.createElement('canvas');
        canvas.width=p.width;canvas.height=p.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);image.close();
        pixels.push(ctx.getImageData(0,0,p.width,p.height).data);
      }
      let different=0,red=0,green=0,blue=0;
      for(let i=0;i<pixels[0].length;i+=4){
        if(pixels[1].slice(i,i+4).some((v,j)=>v!==pixels[0][i+j]||v!==pixels[2][i+j]))different++;
        const [r,g,b]=pixels[0].slice(i,i+3);if(r>200&&g<50&&b<50)red++;if(g>200&&r<50&&b<50)green++;if(b>200&&r<50&&g<50)blue++;
      }
      a.dispose();b.dispose();return{different,red,green,blue,exact:before===JSON.stringify(reopened),sourceExact:source===JSON.stringify(p),keys:q.layers[0].keys.map(k=>k.frame),restricted:q.layers[0].liveMotionSpans!.every(s=>s.groupPaths!.every(b=>!!b.restrictedArc))};
    },{basis,frame,preparation});
    expect(result.different).toBe(0);expect(result.red).toBeGreaterThan(100);expect(result.green).toBeGreaterThan(100);expect(result.blue).toBeGreaterThan(40);expect(result.exact).toBe(true);expect(result.sourceExact).toBe(true);expect(result.keys).toEqual([0,4,8,10]);expect(result.restricted).toBe(true);
  });
for (const basis of ['plain', 'affine', 'reflected'])
  for (const frame of [1, 3, 5, 7])
    test(`recursive original-clock ${basis} frame${frame} preserves original complete PNGs through reopen`, async ({ page }) => {
      await page.goto('/'); await page.addScriptTag({ content: code });
      const result = await page.evaluate(async ({ basis, frame }) => {
        const api = (window as unknown as { GroupPaths: API }).GroupPaths, { p, r } = api.recursiveRestrictedArcProject(basis);
        const before = JSON.stringify(r), reopened = api.migrateProject(JSON.parse(before));
        const a = api.captureLiveMotionStage(() => ({ project: p, revision: 0 }));
        const b = api.captureLiveMotionStage(() => ({ project: reopened, revision: 0 }));
        const pictures: Uint8ClampedArray[] = [];
        for (const view of [a.sample(frame).project, b.sample(frame).project, await api.prepareLiveMotionFrameCapture(() => ({ project: reopened, revision: 0 }), frame)]) {
          const bitmap = await createImageBitmap(await api.exportPNGFrame(view, frame));
          const c = document.createElement('canvas'); c.width = p.width; c.height = p.height;
          const ctx = c.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
          pictures.push(ctx.getImageData(0, 0, p.width, p.height).data);
        }
        let different = 0, red = 0, green = 0, blue = 0;
        for (let i = 0; i < pictures[0].length; i += 4) {
          if (pictures[0].slice(i, i + 4).some((v, j) => v !== pictures[1][i + j] || v !== pictures[2][i + j])) different++;
          const [r, g, b] = pictures[0].slice(i, i + 3);
          if (r > 200 && g < 50 && b < 50) red++;
          if (g > 200 && r < 50 && b < 50) green++;
          if (b > 200 && r < 50 && g < 50) blue++;
        }
        a.dispose(); b.dispose();
        return { different, red, green, blue, exact: JSON.stringify(r) === before && JSON.stringify(reopened) === before, keys: r.layers[0].keys.map((k) => k.frame) };
      }, { basis, frame });
      expect(result.different).toBe(0); expect(result.red).toBeGreaterThan(100); expect(result.green).toBeGreaterThan(100); expect(result.blue).toBeGreaterThan(40);
      expect(result.exact).toBe(true); expect(result.keys).toEqual([0, 2, 4, 6, 8, 10]);
    });
for (const side of ['original', 'left', 'right'])
  for (const basis of ['plain', 'affine', 'reflected'])
    test(`persisted ${basis}/${side} group routes keep stage/PNG pixels and other groups exact`, async ({
      page,
    }) => {
      await page.goto('/');
      await page.addScriptTag({ content: code });
      const result = await page.evaluate(
        async ({ basis, side }) => {
          const frame = side === 'left' ? 3 : side === 'right' ? 5 : 4;
          const api = (window as unknown as { GroupPaths: API }).GroupPaths,
            { p } = api.liveRotationFixture('rigid', basis, true);
          p.width = 400;
          const l = p.layers[0];
          l.keys[1].shapes = l.keys[0].shapes.map((s) => ({
            ...structuredClone(s),
            x: s.x + 80,
            y: s.y + 16,
          }));
          for (const key of l.keys.slice(0, 2))
            for (const s of key.shapes) {
              s.opacity = 1;
              s.fill =
                s.id === 'loose' ? '#0000ff' : s.groups?.[0] === 'second' ? '#00ff00' : '#ff0000';
            }
          l.liveMotionSpans![0].path = { startX: 0, startY: 40, endX: 0, endY: 40 };
          const original = JSON.stringify(p),
            q = api.prepareUpdateLiveMotionSpans(p, [
              {
                layerId: 'track',
                spanId: 'live',
                changes: {
                  groupPaths: [
                    {
                      groupId: 'outer',
                      composition: 'additive',
                      path: { startX: 0, startY: -40, endX: 0, endY: -40 },
                    },
                  ],
                },
              },
            ]),
            reopened = api.migrateProject(
              JSON.parse(
                JSON.stringify(
                  side === 'original'
                    ? q
                    : {
                        ...q,
                        layers: [
                          api.splitLiveGroupMotionLayer(
                            q,
                            q.layers[0],
                            q.layers[0].liveMotionSpans![0],
                            4,
                            'right',
                          ),
                        ],
                      },
                ),
              ),
            ),
            saved = JSON.stringify(reopened),
            read = () => ({ project: reopened, revision: 0 }),
            stage = api.captureLiveMotionStage(read),
            unsplit = api.captureLiveMotionStage(() => ({ project: q, revision: 0 })),
            old = api.captureLiveMotionStage(() => ({ project: p, revision: 0 }));
          const render = await api.prepareLiveMotionFrameCapture(read, frame),
            views = [
              stage.sample(frame).project,
              render,
              unsplit.sample(frame).project,
              old.sample(frame).project,
            ],
            pixels: Uint8ClampedArray[] = [];
          for (const project of views) {
            const bitmap = await createImageBitmap(await api.exportPNGFrame(project, frame)),
              c = document.createElement('canvas');
            c.width = 400;
            c.height = 240;
            const ctx = c.getContext('2d')!;
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            pixels.push(ctx.getImageData(0, 0, 400, 240).data);
          }
          let difference = 0,
            preservedDifference = 0,
            changed = 0,
            red = 0,
            green = 0,
            blue = 0,
            foreignChanges = 0;
          for (let i = 0; i < pixels[0].length; i += 4) {
            const a = pixels[0],
              b = pixels[1],
              c = pixels[3];
            if (a.slice(i, i + 4).some((v, j) => v !== pixels[2][i + j])) preservedDifference++;
            if (a.slice(i, i + 4).some((v, j) => v !== b[i + j])) difference++;
            if (a.slice(i, i + 4).some((v, j) => v !== c[i + j])) changed++;
            if (a[i] > 200 && a[i + 1] < 50 && a[i + 2] < 50) red++;
            if (a[i] < 50 && a[i + 1] > 200 && a[i + 2] < 50) green++;
            if (a[i] < 50 && a[i + 1] < 50 && a[i + 2] > 200) blue++;
            if (
              (c[i] < 50 && c[i + 1] > 200 && c[i + 2] < 50) ||
              (c[i] < 50 && c[i + 1] < 50 && c[i + 2] > 200)
            )
              if (a.slice(i, i + 4).some((v, j) => v !== c[i + j])) foreignChanges++;
          }
          stage.dispose();
          unsplit.dispose();
          old.dispose();
          return {
            difference,
            preservedDifference,
            changed,
            red,
            green,
            blue,
            foreignChanges,
            sourceExact: original === JSON.stringify(p),
            savedExact: saved === JSON.stringify(reopened),
          };
        },
        { basis, side },
      );
      expect(result.difference).toBe(0);
      expect(result.preservedDifference).toBe(0);
      expect(result.changed).toBeGreaterThan(100);
      expect(result.red).toBeGreaterThan(100);
      expect(result.green).toBeGreaterThan(100);
      expect(result.blue).toBeGreaterThan(40);
      expect(result.foreignChanges).toBe(0);
      expect(result.sourceExact).toBe(true);
      expect(result.savedExact).toBe(true);
    });
