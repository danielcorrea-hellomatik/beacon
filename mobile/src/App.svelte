<script lang="ts">
  import Router from 'svelte-spa-router';
  import Home from './routes/Home.svelte';
  import Mac from './routes/Mac.svelte';
  import Session from './routes/Session.svelte';
  import Settings from './routes/Settings.svelte';

  const routes = {
    '/':                Home,
    '/mac/:id':         Mac,
    '/session/:id':     Session,
    '/settings':        Settings,
    '*':                Home
  };
</script>

<!--
  Wrapper que limita la app a 480px (ancho típico móvil) y centra cuando se ve
  en pantalla grande. En móvil ocupa todo el ancho. Mantiene el look "una app
  de teléfono" en cualquier dispositivo.
-->
<main class="min-h-screen bg-bg-base text-text-primary">
  <div class="mx-auto max-w-[480px] min-h-screen border-x border-bg-line/40">
    <Router {routes} />
  </div>
</main>
