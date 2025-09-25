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
        <div>It's</div>
        <div>MyTabs</div>
    </router-link>
</template>

<style scoped lang="scss">
.navbar-brand {
    $width: 100px;

    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    width: $width;
    height: $width;
    font-weight: bold;
    font-size: 20px;

    // gradient primary color
    $startColor: #7e7edf;
    $endColor: #3131c6;
    background: linear-gradient(75deg, $startColor, $endColor);
    transition: all ease-in-out 0.3s;

    div {
        line-height: 22px;
    }

    &:hover {
        opacity: 0.8;
    }

    &.inline {
        display: inline-flex;
    }
}
</style>
