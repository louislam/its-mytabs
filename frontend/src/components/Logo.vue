<script>
export default {
    props: {
        inline: {
            type: Boolean,
            default: false,
        },
    },
};
</script>

<template>
    <router-link
        :class='
            {
                "navbar-brand": true,
                "inline": inline,
            }
        '
        to="/"
    >
        <img src="/icon.png" alt="It's MyTabs" />
    </router-link>
</template>

<style scoped lang="scss">
.navbar-brand {
    $width: 100px;
    width: $width;
    height: $width;
    transition: opacity 0.2s ease-in-out;

    img {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }

    &:hover {
        opacity: 0.9;
    }
}
</style>
