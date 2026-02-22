<?php

namespace Drupal\valet\Form;

use Drupal\Component\Utility\Html;
use Drupal\Component\Utility\NestedArray;
use Drupal\Core\Cache\Cache;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Form\SubformState;
use Drupal\valet\ValetResourceManagerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Valet admin form.
 *
 * @package Drupal\valet\Form
 */
class ValetAdminForm extends ConfigFormBase {

  /**
   * The Valet resource manager.
   *
   * @var \Drupal\exo_valet\ValetResourceManagerInterface
   */
  protected $valetResourceManager;

  /**
   * Constructs a \Drupal\system\ConfigFormBase object.
   *
   * @param \Drupal\Core\Config\ConfigFactoryInterface $config_factory
   *   The factory for configuration objects.
   * @param \Drupal\valet\ValetResourceManagerInterface $valet_resource_manager
   *   The Valet resource manager.
   */
  public function __construct(ConfigFactoryInterface $config_factory, ValetResourceManagerInterface $valet_resource_manager) {
    parent::__construct($config_factory);
    $this->valetResourceManager = $valet_resource_manager;
  }

  /**
   * {@inheritDoc}
   */
  public static function create(ContainerInterface $container) {
    return new static(
      $container->get('config.factory'),
      $container->get('plugin.manager.valet_resource')
    );
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames() {
    return [
      'valet.admin',
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'valet_admin_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $config = $this->config('valet.admin');

    $form['theme'] = [
      '#type' => 'exo_style_theme',
      '#title' => $this->t('Theme'),
      '#default_value' => $config->get('theme'),
      '#empty_option' => $this->t('- Auto -'),
    ];

    $form['tabs'] = [
      '#type' => 'vertical_tabs',
      '#settings_toggle_skip' => TRUE,
    ];

    $form['plugins'] = [
      '#type' => 'container',
      '#settings_strict' => TRUE,
      '#tree' => TRUE,
    ];
    foreach ($this->valetResourceManager->getInstances() as $id => $instance) {
      $form['plugins'][$id] = [
        '#type' => 'details',
        '#title' => $instance->getPluginDefinition()['label'],
        '#group' => 'tabs',
        '#settings_root' => TRUE,
      ];
      $form['plugins'][$id]['status'] = [
        '#type' => 'checkbox',
        '#title' => t('Enabled'),
        '#id' => Html::getUniqueId('exo-valet-' . $id . '-status'),
        '#default_value' => $this->getValue(['plugins', $id, 'status'], FALSE),
      ];
      $form['plugins'][$id]['settings'] = [];
      $subform_state = SubformState::createForSubform($form['plugins'][$id]['settings'], $form, $form_state);
      if ($settings_form = $instance->buildConfigurationForm($form['plugins'][$id]['settings'], $subform_state)) {
        $form['plugins'][$id]['settings'] = $settings_form + [
          '#type' => 'fieldset',
          '#title' => $this->t('Settings'),
          '#states' => [
            'visible' => ['#' . $form['plugins'][$id]['status']['#id'] => ['checked' => TRUE]],
          ],
        ];
      }
    }

    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state) {
    parent::validateForm($form, $form_state);
    // Allow plugin to validate.
    foreach ($this->valetResourceManager->getInstances() as $id => $instance) {
      $subform_state = SubformState::createForSubform($form['plugins'][$id]['settings'], $form, $form_state);
      $instance->validateConfigurationForm($form['plugins'][$id]['settings'], $subform_state);
    }
    $plugins = $form_state->getValue('plugins') ?: [];
    foreach ($plugins as $id => $plugin) {
      if (empty($plugin['status'])) {
        unset($plugins[$id]['settings']);
      }
    }
    $form_state->setValue('plugins', $plugins);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $this->config('valet.admin')
      ->set('plugins', $form_state->getValue('plugins'))
      ->save();
    valet_cache_flush();
    parent::submitForm($form, $form_state);
  }

  /**
   * {@inheritDoc}
   */
  public function getValues() {
    return $this->config('valet.admin')->getRawData();
  }

  /**
   * {@inheritDoc}
   */
  public function getValue($key, $default = NULL) {
    $exists = NULL;
    $values = $this->getValues();
    $value = NestedArray::getValue($values, (array) $key, $exists);
    if (!$exists) {
      $value = $default;
    }
    return $value;
  }

}
