<?php

namespace Drupal\valet\Annotation;

use Drupal\Component\Annotation\Plugin;

/**
 * Defines a Valet Resource item annotation object.
 *
 * @see \Drupal\valet\Plugin\ValetResourceManager
 * @see plugin_api
 *
 * @Annotation
 */
class ValetResource extends Plugin {

  /**
   * The plugin ID.
   *
   * @var string
   */
  public $id;

  /**
   * The label of the plugin.
   *
   * @var \Drupal\Core\Annotation\Translation
   *
   * @ingroup plugin_translatable
   */
  public $label;

  /**
   * The weight of the plugin.
   *
   * An integer to determine the weight of this plugin relative to other
   * plugins in the Valet UI.
   *
   * @var int
   */
  public $weight;

}
