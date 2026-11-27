import { expect, test, type Page } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';

async function setup(page: Page, p = newProject()) {
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const tools = page.getByRole('complementary', { name: 'Drawing tools', exact: true });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  return { p, tools, read };
}

for (const mode of ['object', 'merge'] as const)
test(`toolbar No stroke draws fill-only shapes in ${mode} mode and restores the original outline`, async ({ page }) => {
  const project = newProject();
  project.width = 460;
  project.height = 310;
  project.layers[0].drawingMode = mode;
  const { tools, read } = await setup(page, project);
  const selectTool = (name: string) => tools.getByRole('button', { name, exact: true }).click();
  const noStroke = tools.getByRole('button', { name:'No stroke for shapes', exact:true });
  const stroke = tools.getByLabel('Drawing stroke', { exact:true });
  await stroke.fill('#135ab7');
  await noStroke.click();
  await expect(noStroke).toHaveAttribute('aria-pressed','true');
  await expect(stroke).toHaveValue('#135ab7');
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const canvas = page.getByLabel('Drawing stage',{exact:true});
  const box = (await canvas.boundingBox())!;
  const at = (x:number,y:number) => [box.x+(box.width-project.width)/2+x,box.y+(box.height-project.height)/2+y] as const;
  const draw = async (x:number,y:number) => {
    await page.mouse.move(...at(x,y));
    await page.mouse.down();
    await page.mouse.move(...at(x+42,y+47),{steps:5});
    await page.mouse.up();
  };
  const artwork = async () => (await read()).layers[0].keys[0].shapes;
  for (const [index, name] of ['Rectangle','Rounded rectangle','Oval','Polystar'].entries()) {
    await selectTool(name);
    await draw([55,153,251,366][index],80);
    await expect.poll(async()=> (await artwork()).length).toBe(index+1);
  }
  const fillOnly = await artwork();
  expect(fillOnly.every(shape=>shape.strokeWidth === 0 && shape.fillEnabled !== false)).toBe(true);

  await selectTool('Pen');
  for (const [x,y] of [[120,228],[185,230],[172,275],[120,228]]) await page.mouse.click(...at(x,y));
  await expect.poll(async()=> (await artwork()).length).toBe(5);
  expect((await artwork()).every(shape=>shape.strokeWidth === 0)).toBe(true);

  await selectTool('Line');
  await draw(60,170);
  await expect.poll(async()=> (await artwork()).some(shape=>shape.strokeWidth === 2 && shape.stroke === '#135ab7')).toBe(true);
  await expect(noStroke).toHaveAttribute('aria-pressed','true');

  await noStroke.click();
  await expect(noStroke).toHaveAttribute('aria-pressed','false');
  await selectTool('Rectangle');
  await draw(265,171);
  await expect.poll(async()=> (await artwork()).filter(shape=>shape.strokeWidth === 2 && shape.stroke === '#135ab7').length).toBeGreaterThan(1);
  await noStroke.click();
  await stroke.fill('#d13569');
  await expect(noStroke).toHaveAttribute('aria-pressed','false');
});
test('vector toolbar has distinct solid/hollow arrows and recognizable tool controls with unchanged shortcuts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const f = await setup(page);
  const selection = f.tools.getByRole('button', { name: 'Selection', exact: true }),
    sub = f.tools.getByRole('button', { name: 'Subselection', exact: true });
  expect(
    await selection
      .locator('svg path')
      .first()
      .evaluate((n) => getComputedStyle(n).fill),
  ).not.toBe('none');
  expect(
    await sub
      .locator('svg path')
      .first()
      .evaluate((n) => getComputedStyle(n).fill),
  ).toBe('none');
  for (const [name, key] of [
    ['Selection', 'v'],
    ['Subselection', 'a'],
    ['Paint bucket', 'k'],
    ['Eyedropper', 'i'],
    ['Gradient transform', 'f'],
    ['Eraser', 'e'],
    ['Brush', 'b'],
  ] as const) {
    const button = f.tools.getByRole('button', { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const svg = button.locator('svg');
    await expect(svg).toHaveAttribute('aria-hidden', 'true');
    await expect(svg).toHaveAttribute('focusable', 'false');
    const b = (await svg.boundingBox())!,
      r = (await button.boundingBox())!;
    expect(b.width).toBe(24);
    expect(b.height).toBe(24);
    expect(b.x).toBeGreaterThanOrEqual(r.x);
    expect(b.x + b.width).toBeLessThanOrEqual(r.x + r.width);
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('h');
    await page.keyboard.press(key);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await selection.click();
  await f.tools.evaluate((n) => (n.scrollTop = 0));
  await f.tools.screenshot({ path: test.info().outputPath('toolbar-icons.png') });
  await sub.click();
  await f.tools.screenshot({ path: test.info().outputPath('toolbar-subselection.png') });
  expect(await f.read()).toEqual(f.p);
});
test('icons remain centred and reachable in narrow and wider resized toolbars', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  const f = await setup(page),
    divider = page.getByRole('separator', { name: 'Resize drawing tools', exact: true });
  await divider.focus();
  await divider.press('Home');
  for (const name of [
    'Selection',
    'Subselection',
    'Paint bucket',
    'Eyedropper',
    'Gradient transform',
    'Eraser',
  ]) {
    const button = f.tools.getByRole('button', { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const b = (await button.locator('svg').boundingBox())!,
      r = (await f.tools.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(r.x);
    expect(b.x + b.width).toBeLessThanOrEqual(r.x + r.width);
  }
  await expect.poll(() => f.tools.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);
  await divider.focus();
  await divider.press('End');
  await f.tools.evaluate((n) => (n.scrollTop = 0));
  await f.tools.screenshot({ path: test.info().outputPath('toolbar-icons-wide.png') });
  expect(await f.read()).toEqual(f.p);
});
