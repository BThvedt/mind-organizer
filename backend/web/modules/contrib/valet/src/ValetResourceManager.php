<?php

namespace Drupal\valet;

use Drupal\Core\Plugin\DefaultPluginManager;
use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;

/**
 * Provides the Valet Resource plugin manager.
 */
class ValetResourceManager extends DefaultPluginManager implements ValetResourceManagerInterface {

  /**
   * Provides default values for all style_variable plugins.
   *
   * @var array
   */
  protected $defaults = [
    'id' => '',
    'label' => '',
    'weight' => 0,
  ];

  /**
   * Constructs a new ValetResourceManager object.
   *
   * @param \Traversable $namespaces
   *   An object that implements \Traversable which contains the root paths
   *   keyed by the corresponding namespace to look for plugin implementations.
   * @param \Drupal\Core\Cache\CacheBackendInterface $cache_backend
   *   Cache backend instance to use.
   * @param \Drupal\Core\Extension\ModuleHandlerInterface $module_handler
   *   The module handler to invoke the alter hook with.
   */
  public function __construct(\Traversable $namespaces, CacheBackendInterface $cache_backend, ModuleHandlerInterface $module_handler) {
    parent::__construct('Plugin/ValetResource', $namespaces, $module_handler, 'Drupal\valet\Plugin\ValetResourceInterface', 'Drupal\valet\Annotation\ValetResource');
    $this->alterInfo('valet_resource_info');
    $this->setCacheBackend($cache_backend, 'valet_resource_plugins');
  }

  /**
   * {@inheritdoc}
   */
  public function getDefinitions() {
    $definitions = parent::getDefinitions();
    uasort($definitions, function ($a, $b) {
      $a_weight = $a['weight'] ?? 0;
      $b_weight = $b['weight'] ?? 0;
      if ($a_weight == $b_weight) {
        $a_label = $a['label'];
        $b_label = $b['label'];
        return strnatcasecmp($a_label, $b_label);
      }
      return ($a_weight < $b_weight) ? -1 : 1;
    });
    return $definitions;
  }

  /**
   * {@inheritdoc}
   */
  public function getInstances() {
    $instances = [];
    $config = \Drupal::config('valet.admin');
    $pluginSettings = $config->get('plugins') ?? [];
    foreach ($this->getDefinitions() as $definition) {
      $instances[$definition['id']] = $this->createInstance($definition['id'], $pluginSettings[$definition['id']]['settings'] ?? []);
    }
    return $instances;
  }

  /**
   * {@inheritdoc}
   */
  public function getEnabledInstances() {
    $instances = [];
    $config = \Drupal::config('valet.admin');
    $pluginSettings = $config->get('plugins') ?? [];
    foreach ($this->getDefinitions() as $definition) {
      if (empty($pluginSettings[$definition['id']]['status'])) {
        continue;
      }
      $instances[$definition['id']] = $this->createInstance($definition['id'], $pluginSettings[$definition['id']]['settings'] ?? []);
    }
    return $instances;
  }

}
