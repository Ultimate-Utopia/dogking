<script lang="ts">
	import '../../app.css';
	import './admin.css';

	let { data, children } = $props();
</script>

<svelte:head>
	<title>後台控制台 — 終焉狗王大賽</title>
</svelte:head>

<div class="admin-shell">
	<header class="admin-bar">
		<a class="admin-brand" href="/admin">終焉狗王大賽 <span>控制台</span></a>
		<div class="admin-who">
			<a href="/admin/coins">狗狗幣發放</a>
			{data.admin.displayName}
			<a href="/">回前台</a>
		</div>
	</header>

	<main class="admin-main">
		{@render children()}
	</main>
</div>
