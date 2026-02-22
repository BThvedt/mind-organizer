<?php

namespace Drupal\valet\Controller;

use Drupal\Core\Controller\ControllerBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

use Symfony\Component\HttpFoundation\JsonResponse;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Access\CsrfTokenGenerator;
use Drupal\Core\Cache\Cache;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\valet\Plugin\ValetItems;
use Drupal\valet\ValetResourceManagerInterface;

/**
 * Instance of ValetController.
 */
class ValetController extends ControllerBase {

  /**
   * The CSRF token generator to validate the form token.
   *
   * @var \Drupal\Core\Access\CsrfTokenGenerator
   */
  protected $csrfToken;

  /**
   * The module handler.
   *
   * @var \Drupal\Core\Extension\ModuleHandlerInterface
   */
  protected $moduleHandler;

  /**
   * The Valet resource manager.
   *
   * @var \Drupal\valet\ValetResourceManagerInterface
   */
  protected $valetResourceManager;

  /**
   * {@inheritdoc}
   */
  public function __construct(CsrfTokenGenerator $csrf_token, ModuleHandlerInterface $module_handler, ValetResourceManagerInterface $valet_resource_manager) {
    $this->csrfToken = $csrf_token;
    $this->moduleHandler = $module_handler;
    $this->valetResourceManager = $valet_resource_manager;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static(
      $container->get('csrf_token'),
      $container->get('module_handler'),
      $container->get('plugin.manager.valet_resource')
    );
  }

  /**
   * Return the data for Valet consumption.
   *
   * @return Symfony\Component\HttpFoundation\JsonResponse
   *   A json object.
   */
  public function data() {
    $cid = 'valet:' . $this->csrfToken->get('/api/valet');
    if ($cache = \Drupal::cache()->get($cid)) {
      return new JsonResponse($cache->data);
    }
    $items = new ValetItems();
    $cacheable_metadata = new CacheableMetadata();
    $cacheable_metadata->addCacheTags([
      'valet',
      'valet_resources',
      'config:core.extension',
    ]);

    /** @var \Drupal\valet\Plugin\Settings\ValetSettingsInterface $settings */
    // $settings = $this->valetRepository->getActive();
    $settings = [];
    $cacheable_metadata->addCacheableDependency($settings);
    foreach ($this->valetResourceManager->getEnabledInstances() as $instance) {
      foreach ($instance->getResults() as $item) {
        $items->appendItem($item);
      }
      $cacheable_metadata->addCacheableDependency($instance);
    }

    // Invoke alter hook.
    $this->moduleHandler->alter('valet_results', $items);
    $data = $items->toArray();

    // Cache.
    \Drupal::cache()->set($cid, $data, Cache::PERMANENT, $cacheable_metadata->getCacheTags());

    return new JsonResponse($data);
  }

}
