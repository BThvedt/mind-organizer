const gulp = require('gulp');
const { parallel, series } = require('gulp');
const sass = require('gulp-sass')(require('sass'));
const glob = require('gulp-sass-glob');
const plumber = require('gulp-plumber');
const autoprefixer = require('gulp-autoprefixer');
const sourcemaps = require('gulp-sourcemaps');
const uglify = require('gulp-uglify');
const typescript = require('gulp-typescript');
const tsProject = typescript.createProject('./tsconfig.json');
const eslint = require('gulp-eslint');
const babel = require('gulp-babel');
let config = {
  css: {
    dest: 'css',
    src: ['src/scss/*.scss'],
  },
  js: {
    dest: 'js',
    src: ['src/js/*.js'],
  },
  ts: {
    dest: 'js',
    src: ['src/ts/*.ts'],
  },
};
let watchStatus = false;

function js(cb) {
  gulp.src(config.js.src)
    .pipe(plumber())
    .pipe(eslint({
      configFile: './.eslintrc',
      useEslintrc: false
    }))
    .pipe(eslint.format())
    .pipe(babel({
      presets: ['@babel/preset-env']
    }))
    .pipe(uglify())
    .pipe(plumber.stop())
    .pipe(gulp.dest(config.js.dest));

  cb();
}

function ts(cb) {
  gulp.src(config.ts.src)
    .pipe(plumber())
    .pipe(sourcemaps.init())
    .pipe(tsProject())
    .pipe(babel({
      presets: ['@babel/preset-env']
    }))
    .pipe(uglify())
    .pipe(plumber.stop())
    .pipe(sourcemaps.write('./'))
    .pipe(gulp.dest(config.ts.dest));
  cb();
}

function css(cb) {
  gulp.src(config.css.src)
    .pipe(plumber())
    .pipe(glob())
    .pipe(sourcemaps.init())
    .pipe(sass({
      outputStyle: 'compressed'
    }).on('error', sass.logError))
    .pipe(autoprefixer({
      browserlist: ['last 2 versions'],
      cascade: false
    }))
    .pipe(plumber.stop())
    .pipe(sourcemaps.write('./'))
    .pipe(gulp.dest(config.css.dest))
    ;
  cb();
}

function enableWatch(cb) {
  watchStatus = true;
  cb();
}

function watch(cb) {
  if (watchStatus) {
    gulp.watch(config.css.src, css);
    gulp.watch(config.js.src, js);
    gulp.watch(config.ts.src, ts);
  }
  else {
    cb();
  }
}

exports.default = parallel(js, css, ts);
exports.watch = series(enableWatch, parallel(js, css, ts), watch);
