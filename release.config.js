//Release workflow from: https://github.com/deskaide/deskaide, https://shahid.pro/blog/2023/02/20/release-electron-app-to-github-using-semantic-release-and-electron-builder/

module.exports = {
    branches: [
        'main',
        'next',
        'next-major',
        { name: 'beta', prerelease: true },
        { name: 'alpha', prerelease: true },
    ],
    plugins: [
        '@semantic-release/commit-analyzer',
        'semantic-release-export-data',
        '@semantic-release/npm',
        [
            '@semantic-release/git',
            {
                assets: ['package.json', 'package-lock.json'],
            },
        ],
    ],
};