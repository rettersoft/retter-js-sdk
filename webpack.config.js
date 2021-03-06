const path = require('path')

module.exports = {
    mode: 'production',
    entry: './src/index.ts',
    module: {
        rules: [
            {
                test: /\.ts?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    output: {
        filename: 'index.js',
        path: path.resolve(__dirname, 'bundle'),
        library: {
            name: 'Retter',
            type: 'umd',
            export: 'default',
        },
    },
    performance: {
        hints: false,
    },
}
