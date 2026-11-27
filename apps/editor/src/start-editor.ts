import { mount, tick } from 'svelte';
import App from './App.svelte';
import './style.css';

export async function startEditor(target: HTMLElement) {
  mount(App, { target });
  await tick();
}
